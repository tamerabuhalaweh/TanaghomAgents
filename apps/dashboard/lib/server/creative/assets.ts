import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";
import {
  CreativeDisabledError,
  requireCreativeStudio,
} from "@/lib/server/creative/feature-control";
import {
  IdempotencyRequestError,
  completeIdempotency,
  idempotencyKey,
  reserveIdempotency,
} from "@/lib/server/creative/idempotency";
import { CreativeJobRequestError } from "@/lib/server/creative/jobs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, code: string) {
  if (!UUID_RE.test(value)) throw new CreativeJobRequestError(code, 400);
}

export async function listCreativeAssets(request: NextRequest) {
  try {
    requireCreativeStudio();
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT asset.id AS asset_id, asset.capability, asset.title,
              asset.originating_job_id, asset.created_at,
              version.id AS latest_version_id, version.version AS latest_version,
              version.mime, version.status AS review_status
         FROM tanaghom.creative_assets asset
         JOIN LATERAL (
           SELECT * FROM tanaghom.creative_asset_versions
            WHERE asset_id = asset.id ORDER BY version DESC LIMIT 1
         ) version ON true
        WHERE asset.organization_id = $1
        ORDER BY asset.created_at DESC
        LIMIT 50`,
      [user.organizationId],
    );
    return noStore({ assets: result.rows });
  } catch (error) {
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}

export async function getCreativeAssetVersion(request: NextRequest, versionId: string) {
  try {
    requireCreativeStudio();
    assertUuid(versionId, "invalid_version_id");
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT version.id AS asset_version_id, version.asset_id, version.version,
              version.parent_version_id, version.job_id, version.title, version.mime,
              version.width, version.height, version.duration_ms, version.bytes,
              version.sha256, version.object_key, version.thumb_key,
              version.provenance, version.prompt_ref, version.template_ref,
              version.method, version.status, version.created_at,
              asset.capability, asset.organization_id
         FROM tanaghom.creative_asset_versions version
         JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
        WHERE version.id = $1 AND asset.organization_id = $2`,
      [versionId, user.organizationId],
    );
    if (!result.rows[0]) return noStore({ error: "version_not_found" }, { status: 404 });
    const { organization_id: _org, ...version } = result.rows[0] as Record<string, unknown>;
    return noStore({ version });
  } catch (error) {
    if (error instanceof CreativeJobRequestError) {
      return noStore({ error: error.code }, { status: error.status });
    }
    if (error instanceof CreativeDisabledError) {
      return noStore({ error: "creative_studio_disabled" }, { status: 503 });
    }
    throw error;
  }
}

interface DecisionInput {
  decision: "approved" | "rejected";
  feedback: string | null;
}

async function decisionInput(request: NextRequest): Promise<DecisionInput> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new CreativeJobRequestError("invalid_json", 400);
  }
  if (!body || typeof body !== "object") throw new CreativeJobRequestError("invalid_decision", 400);
  const record = body as Record<string, unknown>;
  if (record.decision !== "approved" && record.decision !== "rejected") {
    throw new CreativeJobRequestError("invalid_decision", 400);
  }
  const feedback = typeof record.feedback === "string" ? record.feedback.trim() : "";
  if (record.decision === "rejected" && !feedback) {
    throw new CreativeJobRequestError("feedback_required", 400);
  }
  return { decision: record.decision, feedback: feedback || null };
}

export async function decideCreativeAssetVersion(request: NextRequest, versionId: string) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    assertUuid(versionId, "invalid_version_id");
    const [user, input] = await Promise.all([
      authorize(request, ["owner", "reviewer"]),
      decisionInput(request),
    ]);
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ version_id: versionId, ...input, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.decide", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      let status: string;
      // Reuse the originating job's correlation so the decision shares the
      // job trace instead of forking a new one. Org-scoped: foreign versions 404.
      const lineage = await client.query<{ correlation_id: string }>(
        `SELECT job.correlation_id
           FROM tanaghom.creative_asset_versions version
           JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
           JOIN tanaghom.creative_jobs job ON job.id = version.job_id
          WHERE version.id = $1 AND asset.organization_id = $2 AND job.organization_id = $2`,
        [versionId, user.organizationId],
      );
      if (!lineage.rows[0]) throw new CreativeJobRequestError("version_not_found", 404);
      const correlationId = lineage.rows[0].correlation_id as string;
      try {
        const decided = await client.query<{ status: string }>(
          `SELECT tanaghom.decide_creative_asset_version($1,$2,$3,$4) AS status`,
          [user.id, versionId, input.decision, input.feedback],
        );
        status = decided.rows[0].status;
      } catch (error) {
        if (error instanceof Error && /creative asset|feedback/i.test(error.message)) {
          const message = error.message;
          throw new CreativeJobRequestError(
            /not reviewable/.test(message) ? "version_not_reviewable"
              : /unknown creative asset version/.test(message) ? "version_not_found"
              : /decide requires/.test(message) ? "forbidden" : "invalid_decision",
            /unknown creative asset version/.test(message) ? 404
              : /not reviewable/.test(message) ? 409
              : /decide requires/.test(message) ? 403 : 400,
          );
        }
        throw error;
      }
      const responseBody = { ok: true, asset_version_id: versionId, decision: input.decision, status, correlation_id: correlationId };
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log (
           correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
         ) VALUES ($1, $2, $3, 'creative_asset_version', $4, $5::jsonb, 'success')`,
        [correlationId, user.id, `creative.asset_${input.decision}`, versionId,
          JSON.stringify({ decision: input.decision, feedback: input.feedback })],
      );
      await completeIdempotency(client, slot.reservation_id, 200, responseBody);
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
