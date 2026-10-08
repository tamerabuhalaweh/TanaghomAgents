import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";
import { requireCreativeStudio, CreativeDisabledError } from "@/lib/server/creative/feature-control";
import {
  IdempotencyRequestError,
  completeIdempotency,
  idempotencyKey,
  reserveIdempotency,
} from "@/lib/server/creative/idempotency";
import { CreativeJobRequestError } from "@/lib/server/creative/jobs";
import { imageGenerationEnabled, productStudioEnabled } from "@/lib/server/creative/generations";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECKLIST_KEYS = ["logo", "package_text", "shape", "proportions", "primary_colors", "markings"];
const CHECKLIST_VALUES = new Set(["pass", "fail", "unreviewed"]);

export async function recordFidelityReview(request: NextRequest, versionId: string) {
  try {
    requireCreativeStudio();
    if (!imageGenerationEnabled() && !productStudioEnabled()) {
      return noStore({ error: "image_generation_disabled" }, { status: 503 });
    }
    enforceSameOriginForCookieMutation(request);
    if (!UUID_RE.test(versionId)) return noStore({ error: "invalid_version_id" }, { status: 400 });
    const [user, body] = await Promise.all([
      authorize(request, ["owner", "reviewer"]),
      request.json().catch(() => { throw new CreativeJobRequestError("invalid_json", 400); }),
    ]);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreativeJobRequestError("invalid_review", 400);
    const record = body as Record<string, unknown>;
    if (!["passed", "failed", "not_reviewed"].includes(record.overall as string)) {
      throw new CreativeJobRequestError("invalid_overall", 400);
    }
    if (!record.checklist || typeof record.checklist !== "object" || Array.isArray(record.checklist)) {
      throw new CreativeJobRequestError("invalid_checklist", 400);
    }
    for (const [key, value] of Object.entries(record.checklist as Record<string, unknown>)) {
      if (!CHECKLIST_KEYS.includes(key) || !CHECKLIST_VALUES.has(value as string)) {
        throw new CreativeJobRequestError("invalid_checklist", 400);
      }
    }
    if (record.overall === "passed" && record.override_reason !== undefined && record.override_reason !== null) {
      throw new CreativeJobRequestError("override_only_with_failed", 400);
    }
    if (record.override_reason !== undefined && record.override_reason !== null
      && (typeof record.override_reason !== "string" || record.override_reason.length < 1 || record.override_reason.length > 2000)) {
      throw new CreativeJobRequestError("invalid_override_reason", 400);
    }
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ version_id: versionId, ...record, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.fidelity", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      let reviewId: string;
      try {
        const created = await client.query<{ id: string }>(
          `SELECT tanaghom.record_creative_fidelity_review($1,$2,$3,$4,$5) AS id`,
          [user.id, versionId, JSON.stringify(record.checklist),
            record.overall, (record.override_reason as string | null) ?? null],
        );
        reviewId = created.rows[0].id;
      } catch (error) {
        if (error instanceof Error && /fidelity review requires|unknown creative asset version|invalid fidelity review/.test(error.message)) {
          throw new CreativeJobRequestError(
            error.message.includes("unknown") ? "version_not_found"
              : error.message.includes("requires") ? "forbidden" : "invalid_review",
            error.message.includes("unknown") ? 404 : error.message.includes("requires") ? 403 : 400,
          );
        }
        throw error;
      }
      const responseBody = { ok: true, review_id: reviewId, overall: record.overall };
      await completeIdempotency(client, (slot as { reservation_id: string }).reservation_id, 200, responseBody);
      await client.query("COMMIT");
      return noStore(responseBody);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof CreativeJobRequestError || error instanceof IdempotencyRequestError) {
      return noStore({ error: error.code }, { status: error.status });
    }
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}

export async function getFidelityHistory(request: NextRequest, versionId: string) {
  try {
    requireCreativeStudio();
    if (!UUID_RE.test(versionId)) return noStore({ error: "invalid_version_id" }, { status: 400 });
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT review.id AS review_id, review.overall, review.checklist,
              review.override_reason, review.created_at,
              reviewer.display_name AS reviewer_name
         FROM tanaghom.creative_fidelity_reviews review
         JOIN tanaghom.creative_asset_versions version ON version.id = review.asset_version_id
         JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
         JOIN tanaghom.app_users reviewer ON reviewer.id = review.reviewer_id
        WHERE review.asset_version_id = $1 AND review.organization_id = $2
        ORDER BY review.created_at ASC`,
      [versionId, user.organizationId],
    );
    return noStore({ reviews: result.rows });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}
