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
const VIDEO_OPERATIONS = new Set(["text_to_video", "image_to_video"]);
const VIDEO_DURATIONS = new Set([5, 8, 10]);
const VIDEO_RATIOS = new Set(["16:9", "9:16", "1:1"]);

export const VIDEO_PROVIDER = "minimax";
export const VIDEO_MODEL = "MiniMax-H3";
export const VIDEO_RESOLUTION = "768P";
export const VIDEO_UNIT_PRICE_USD_PER_SECOND = 0.08;

export function generativeVideoEnabled() {
  return process.env.GENERATIVE_VIDEO_ENABLED === "true";
}

export function estimateVideoCostUsd(duration: number) {
  return Math.round(duration * VIDEO_UNIT_PRICE_USD_PER_SECOND * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const UNSAFE_STRING = /https?:|javascript:|data:text\/html|<script|<\/script|<iframe|<style|on\w+\s*=/i;

export async function submitVideoGeneration(request: NextRequest) {
  try {
    requireCreativeStudio();
    if (!generativeVideoEnabled()) {
      return noStore({ error: "generative_video_disabled" }, { status: 503 });
    }
    enforceSameOriginForCookieMutation(request);
    const [user, body] = await Promise.all([
      authorize(request, ["owner", "operator"]),
      request.json().catch(() => { throw new CreativeJobRequestError("invalid_json", 400); }),
    ]);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CreativeJobRequestError("invalid_request", 400);
    const record = body as Record<string, unknown>;
    if (!VIDEO_OPERATIONS.has(record.operation as string)) throw new CreativeJobRequestError("invalid_operation", 400);
    const operation = record.operation as string;
    if (typeof record.prompt !== "string" || !record.prompt.trim() || record.prompt.length > 7000) {
      throw new CreativeJobRequestError("invalid_prompt", 400);
    }
    if (UNSAFE_STRING.test(record.prompt as string)) {
      throw new CreativeJobRequestError("invalid_prompt_unsafe", 400);
    }
    if (!VIDEO_DURATIONS.has(record.duration as number)) throw new CreativeJobRequestError("invalid_duration", 400);
    const duration = record.duration as number;
    let ratio = "adaptive";
    if (operation === "text_to_video") {
      if (!VIDEO_RATIOS.has(record.ratio as string)) throw new CreativeJobRequestError("invalid_ratio", 400);
      ratio = record.ratio as string;
    }
    let sourceVersionId: string | null = null;
    if (operation === "image_to_video") {
      if (typeof record.source_version_id !== "string" || !UUID_RE.test(record.source_version_id)) {
        throw new CreativeJobRequestError("invalid_source_version_id", 400);
      }
      const source = await database().query(
        `SELECT version.id FROM tanaghom.creative_asset_versions version
          JOIN tanaghom.creative_assets asset ON asset.id = version.asset_id
         WHERE version.id = $1 AND asset.organization_id = $2`,
        [record.source_version_id, user.organizationId],
      );
      if (!source.rows[0]) throw new CreativeJobRequestError("source_not_found", 404);
      sourceVersionId = record.source_version_id;
    }
    if (typeof record.correlation_id !== "string" || !UUID_RE.test(record.correlation_id)) {
      throw new CreativeJobRequestError("invalid_correlation_id", 400);
    }
    const headerKey = idempotencyKey(request);
    const correlationId = record.correlation_id as string;
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ ...record, headerKey })).digest("hex")}`;
    const estimate = estimateVideoCostUsd(duration);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.video.generate", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      const created = await client.query<{ job_id: string }>(
        `SELECT tanaghom.create_creative_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS job_id`,
        [user.id, "video", "gpu_video",
          JSON.stringify({
            operation,
            prompt: (record.prompt as string).trim(),
            duration,
            resolution: VIDEO_RESOLUTION,
            ratio,
            ...(sourceVersionId ? { source_asset_version_id: sourceVersionId } : {}),
            provider: VIDEO_PROVIDER,
            model: VIDEO_MODEL,
            unit_price_usd: VIDEO_UNIT_PRICE_USD_PER_SECOND,
          }),
          randomUUID(), correlationId, 0, 3, null, null, null],
      );
      const jobId = created.rows[0].job_id;
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log (
           correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
         ) VALUES ($1, $2, 'creative.job_enqueued', 'creative_job', $3, $4::jsonb, 'success')`,
        [correlationId, user.id, jobId, JSON.stringify({ capability: "video", lane: "gpu_video", operation })],
      );
      const responseBody = {
        ok: true, correlation_id: correlationId, job_ids: [jobId],
        estimate: { unit: "second", unit_price_usd: VIDEO_UNIT_PRICE_USD_PER_SECOND, estimated_cost_usd: estimate, informational_only: true },
      };
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

export async function listVideoJobs(request: NextRequest) {
  try {
    requireCreativeStudio();
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT id AS job_id, capability, lane, status, attempt, correlation_id, created_at
         FROM tanaghom.creative_jobs
        WHERE organization_id = $1 AND capability = 'video'
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
