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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT_ENGINES = new Set(["birefnet", "local-deterministic"]);

export function mlSegmentationEnabled() {
  return process.env.ML_SEGMENTATION_ENABLED === "true";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function submitSegmentation(request: NextRequest) {
  try {
    requireCreativeStudio();
    if (!mlSegmentationEnabled()) {
      return noStore({ error: "ml_segmentation_disabled" }, { status: 503 });
    }
    enforceSameOriginForCookieMutation(request);
    const [user, body] = await Promise.all([
      authorize(request, ["owner", "operator"]),
      request.json().catch(() => { throw new CreativeJobRequestError("invalid_json", 400); }),
    ]);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreativeJobRequestError("invalid_request", 400);
    const record = body as Record<string, unknown>;
    if (typeof record.source_version_id !== "string" || !UUID_RE.test(record.source_version_id)) {
      throw new CreativeJobRequestError("invalid_source_version_id", 400);
    }
    const engine = (record.engine as string) ?? "local-deterministic";
    if (!SEGMENT_ENGINES.has(engine)) throw new CreativeJobRequestError("invalid_engine", 400);
    const refine = (record.refine ?? {}) as Record<string, unknown>;
    if (!isRecord(refine)) throw new CreativeJobRequestError("invalid_refine", 400);
    for (const [key, min, max] of [["feather_px", 0, 8], ["erode_px", 0, 3], ["threshold", 1, 254]] as const) {
      const value = refine[key] ?? (key === "threshold" ? 48 : 0);
      if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
        throw new CreativeJobRequestError(`invalid_refine_${key}`, 400);
      }
    }
    for (const key of Object.keys(refine)) {
      if (!["feather_px", "erode_px", "threshold"].includes(key)) {
        throw new CreativeJobRequestError("invalid_refine_key", 400);
      }
    }
    const source = await database().query(
      `SELECT version.id FROM tanaghom.creative_asset_versions version
        JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
       WHERE version.id = $1 AND asset.organization_id = $2`,
      [record.source_version_id, user.organizationId],
    );
    if (!source.rows[0]) throw new CreativeJobRequestError("source_not_found", 404);
    if (typeof record.correlation_id !== "string" || !UUID_RE.test(record.correlation_id)) {
      throw new CreativeJobRequestError("invalid_correlation_id", 400);
    }
    const headerKey = idempotencyKey(request);
    const correlationId = record.correlation_id as string;
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ ...record, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.segment", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      const created = await client.query<{ job_id: string }>(
        `SELECT tanaghom.create_creative_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS job_id`,
        [user.id, "product_shoot", "cpu",
          JSON.stringify({
            operation: "segment",
            source_asset_version_id: record.source_version_id,
            engine,
            refine: {
              feather_px: (refine.feather_px as number) ?? 0,
              erode_px: (refine.erode_px as number) ?? 0,
              threshold: (refine.threshold as number) ?? 48,
            },
          }),
          randomUUID(), correlationId, 0, 3, null, null, null],
      );
      const jobId = created.rows[0].job_id;
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log (
           correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
         ) VALUES ($1, $2, 'creative.job_enqueued', 'creative_job', $3, $4::jsonb, 'success')`,
        [correlationId, user.id, jobId, JSON.stringify({ capability: "product_shoot", lane: "cpu", operation: "segment", engine })],
      );
      const responseBody = { ok: true, correlation_id: correlationId, job_id: jobId };
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

export async function listSegmentJobs(request: NextRequest) {
  try {
    requireCreativeStudio();
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT id AS job_id, status, attempt, correlation_id, created_at
         FROM tanaghom.creative_jobs
        WHERE organization_id = $1 AND capability = 'product_shoot' AND lane = 'cpu'
          AND params->>'operation' = 'segment'
        ORDER BY created_at DESC
        LIMIT 50`,
      [user.organizationId],
    );
    return noStore({ jobs: result.rows });
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
