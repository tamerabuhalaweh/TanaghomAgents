import "server-only";

import { createHash, randomUUID } from "node:crypto";
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

const CAPABILITIES = new Set([
  "image", "edit", "product_shoot", "design", "carousel", "motion",
  "video", "talking_head", "voice", "music", "landing_page",
]);
const LANES = new Set(["cpu", "gpu_image", "gpu_video", "gpu_audio"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreativeJobRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

interface EnqueueInput {
  capability: string;
  lane: string;
  params: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string;
  priority: number;
  maxAttempts: number;
  templateRef: string | null;
  brandKitVersionId: string | null;
  estimatedCredits: number | null;
}

async function enqueueInput(request: NextRequest): Promise<EnqueueInput> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new CreativeJobRequestError("invalid_json", 400);
  }
  if (!body || typeof body !== "object") throw new CreativeJobRequestError("invalid_job_request", 400);
  const record = body as Record<string, unknown>;
  if (!CAPABILITIES.has(record.capability as string)) throw new CreativeJobRequestError("invalid_capability", 400);
  if (!LANES.has(record.lane as string)) throw new CreativeJobRequestError("invalid_lane", 400);
  if (!record.params || typeof record.params !== "object" || Array.isArray(record.params)) {
    throw new CreativeJobRequestError("invalid_params", 400);
  }
  const params = record.params as Record<string, unknown>;
  if (Object.keys(params).length < 1 || Object.keys(params).length > 64) {
    throw new CreativeJobRequestError("invalid_params", 400);
  }
  for (const key of ["idempotency_key", "correlation_id", "brand_kit_version_id"]) {
    const value = record[key];
    if (value !== undefined && value !== null && (typeof value !== "string" || !UUID_RE.test(value))) {
      throw new CreativeJobRequestError(`invalid_${key}`, 400);
    }
  }
  if (typeof record.idempotency_key !== "string" || typeof record.correlation_id !== "string") {
    throw new CreativeJobRequestError("keys_required", 400);
  }
  const priority = integerIn(record.priority === undefined ? 0 : record.priority, 0, 100);
  const maxAttempts = integerIn(record.max_attempts === undefined ? 3 : record.max_attempts, 1, 10);
  if (priority === null) {
    throw new CreativeJobRequestError("invalid_priority", 400);
  }
  if (maxAttempts === null) {
    throw new CreativeJobRequestError("invalid_max_attempts", 400);
  }
  if (record.template_ref !== undefined && record.template_ref !== null
    && (typeof record.template_ref !== "string" || record.template_ref.length < 1 || record.template_ref.length > 300)) {
    throw new CreativeJobRequestError("invalid_template_ref", 400);
  }
  const estimatedCredits = record.estimated_credits === undefined || record.estimated_credits === null
    ? null
    : integerIn(record.estimated_credits, 0, Number.MAX_SAFE_INTEGER);
  if (record.estimated_credits !== undefined && record.estimated_credits !== null && estimatedCredits === null) {
    throw new CreativeJobRequestError("invalid_estimated_credits", 400);
  }
  return {
    capability: record.capability as string,
    lane: record.lane as string,
    params,
    idempotencyKey: record.idempotency_key,
    correlationId: record.correlation_id,
    priority,
    maxAttempts,
    templateRef: (record.template_ref as string | null) ?? null,
    brandKitVersionId: (record.brand_kit_version_id as string | null) ?? null,
    estimatedCredits,
  };
}

function integerIn(value: unknown, min: number, max: number): number | null {
  if (!Number.isInteger(value)) return null;
  const n = value as number;
  return n >= min && n <= max ? n : null;
}

function fingerprint(input: Record<string, unknown>) {
  return `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}

function assertUuid(value: string, code: string) {
  if (!UUID_RE.test(value)) throw new CreativeJobRequestError(code, 400);
}

export async function enqueueCreativeJob(request: NextRequest) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    const [user, input] = await Promise.all([
      authorize(request, ["owner", "operator"]),
      enqueueInput(request),
    ]);
    const headerKey = idempotencyKey(request);
    const requestHash = fingerprint({ ...input, headerKey });
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.enqueue", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      let jobId: string;
      try {
        const created = await client.query<{ job_id: string }>(
          `SELECT tanaghom.create_creative_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS job_id`,
          [user.id, input.capability, input.lane, JSON.stringify(input.params), input.idempotencyKey,
            input.correlationId, input.priority, input.maxAttempts, input.templateRef,
            input.brandKitVersionId, input.estimatedCredits],
        );
        jobId = created.rows[0].job_id;
      } catch (error) {
        if (error instanceof Error && /creative (idempotency conflict|open job limit|enqueue requires)/.test(error.message)) {
          throw new CreativeJobRequestError(
            error.message.includes("conflict") ? "idempotency_conflict"
              : error.message.includes("limit") ? "open_job_limit_reached" : "forbidden",
            error.message.includes("conflict") ? 409 : error.message.includes("limit") ? 429 : 403,
          );
        }
        throw error;
      }
      const responseBody = { ok: true, job_id: jobId, correlation_id: input.correlationId, delivery: "queued" };
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log (
           correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
         ) VALUES ($1, $2, 'creative.job_enqueued', 'creative_job', $3, $4::jsonb, 'success')`,
        [input.correlationId, user.id, jobId, JSON.stringify({ capability: input.capability, lane: input.lane })],
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

export async function getCreativeJob(request: NextRequest, jobId: string) {
  try {
    requireCreativeStudio();
    assertUuid(jobId, "invalid_job_id");
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const result = await database().query(
      `SELECT id AS job_id, organization_id, capability, lane, status, attempt,
              max_attempts, correlation_id, idempotency_key, cancel_requested,
              error_class, output_asset_ids, created_at, updated_at
         FROM tanaghom.creative_jobs
        WHERE id = $1 AND organization_id = $2`,
      [jobId, user.organizationId],
    );
    if (!result.rows[0]) return noStore({ error: "job_not_found" }, { status: 404 });
    return noStore({ job: result.rows[0] });
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

export async function cancelCreativeJob(request: NextRequest, jobId: string) {
  try {
    requireCreativeStudio();
    enforceSameOriginForCookieMutation(request);
    assertUuid(jobId, "invalid_job_id");
    const user = await authorize(request, ["owner", "operator"]);
    const headerKey = idempotencyKey(request);
    const requestHash = `sha256:${createHash("sha256").update(JSON.stringify({ job_id: jobId, headerKey })).digest("hex")}`;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const slot = await reserveIdempotency(client, user.id, "creative.cancel", headerKey, requestHash);
      if (slot.replayed) {
        await client.query("COMMIT");
        const response = noStore(slot.response_body, { status: slot.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }
      let status: string;
      try {
        const cancelled = await client.query<{ status: string }>(
          `SELECT tanaghom.request_creative_cancel($1,$2) AS status`,
          [user.id, jobId],
        );
        status = cancelled.rows[0].status;
      } catch (error) {
        if (error instanceof Error && /creative (cancel requires|job already terminal)|unknown creative job/.test(error.message)) {
          throw new CreativeJobRequestError(
            error.message.includes("terminal") ? "job_already_terminal"
              : error.message.includes("unknown") ? "job_not_found" : "forbidden",
            error.message.includes("unknown") ? 404 : error.message.includes("terminal") ? 409 : 403,
          );
        }
        throw error;
      }
      const responseBody = { ok: true, job_id: jobId, status };
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log (
           correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result
         ) VALUES ($1, $2, 'creative.job_cancel_requested', 'creative_job', $3, $4::jsonb, 'success')`,
        [randomUUID(), user.id, jobId, JSON.stringify({ status })],
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
