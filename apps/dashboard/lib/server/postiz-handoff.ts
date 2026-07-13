import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";

class PostizHandoffError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function idempotencyKey(request: NextRequest) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new PostizHandoffError("valid_idempotency_key_required", 400);
  }
  return key;
}

function contentId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new PostizHandoffError("invalid_content_item_id", 400);
  }
  return value;
}

function fingerprint(value: string) {
  return `sha256:${createHash("sha256").update(JSON.stringify({ content_item_id: value })).digest("hex")}`;
}

function mapDatabaseGuard(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("content item not found")) return new PostizHandoffError("content_not_found", 404);
  if (message.includes("approved content required") || message.includes("human approval evidence")) {
    return new PostizHandoffError("content_not_approved", 409);
  }
  if (message.includes("Postiz channel mapping required")) {
    return new PostizHandoffError("postiz_channel_not_configured", 409);
  }
  if (message.includes("connected Postiz integration")) return new PostizHandoffError("postiz_connection_not_ready", 409);
  if (message.includes("emergency stop")) return new PostizHandoffError("postiz_automation_emergency_stopped", 409);
  if (message.includes("automation is paused")) return new PostizHandoffError("postiz_automation_paused", 409);
  if (message.includes("indeterminate Postiz operation")) return new PostizHandoffError("postiz_operation_requires_review", 409);
  if (message.includes("publishing operator required")) return new PostizHandoffError("forbidden", 403);
  if (message.includes("publisher agent is unavailable")) return new PostizHandoffError("publisher_unavailable", 503);
  return error;
}

export function postizHandoffEnabled() {
  return process.env.POSTIZ_HANDOFF_ENABLED === "true";
}

export async function requestPostizDraft(request: NextRequest, rawContentId: string) {
  try {
    enforceSameOriginForCookieMutation(request);
    const [user, itemId] = await Promise.all([
      authorize(request, ["owner", "reviewer", "operator"]),
      Promise.resolve(contentId(rawContentId)),
    ]);
    if (!postizHandoffEnabled()) {
      throw new PostizHandoffError("postiz_handoff_not_enabled", 503);
    }
    const key = idempotencyKey(request);
    const requestHash = fingerprint(itemId);
    const client = await database().connect();

    try {
      await client.query("BEGIN");
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO tanaghom.api_idempotency_keys (
           actor_user_id, operation_type, idempotency_key, request_hash
         ) VALUES ($1, 'postiz.draft.request', $2, $3)
         ON CONFLICT (actor_user_id, operation_type, idempotency_key) DO NOTHING
         RETURNING id`,
        [user.id, key, requestHash],
      );

      if (!reservation.rows[0]) {
        const existing = await client.query<{
          request_hash: string;
          status: string;
          response_status: number | null;
          response_body: unknown;
        }>(
          `SELECT request_hash, status, response_status, response_body
             FROM tanaghom.api_idempotency_keys
            WHERE actor_user_id = $1
              AND operation_type = 'postiz.draft.request'
              AND idempotency_key = $2`,
          [user.id, key],
        );
        const replay = existing.rows[0];
        if (!replay || replay.request_hash !== requestHash) {
          throw new PostizHandoffError("idempotency_key_reused", 409);
        }
        if (replay.status !== "completed" || !replay.response_status || !replay.response_body) {
          throw new PostizHandoffError("handoff_in_progress", 409);
        }
        await client.query("COMMIT");
        const response = noStore(replay.response_body, { status: replay.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }

      let queued;
      try {
        queued = await client.query<{
          job_id: string;
          correlation_id: string;
          job_status: string;
        }>(
          "SELECT * FROM tanaghom.queue_postiz_draft($1::uuid, $2::uuid)",
          [itemId, user.id],
        );
      } catch (error) {
        throw mapDatabaseGuard(error);
      }
      const job = queued.rows[0];
      if (!job) throw new PostizHandoffError("publisher_unavailable", 503);

      const responseBody = {
        ok: true,
        content_item_id: itemId,
        job_id: job.job_id,
        correlation_id: job.correlation_id,
        status: job.job_status,
        delivery: "queued_for_inactive_workflow",
      };
      await client.query(
        `UPDATE tanaghom.api_idempotency_keys
            SET status = 'completed', response_status = 202,
                response_body = $2::jsonb, completed_at = now()
          WHERE id = $1`,
        [reservation.rows[0].id, JSON.stringify(responseBody)],
      );
      await client.query("COMMIT");
      return noStore(responseBody, { status: 202 });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof PostizHandoffError) {
      return noStore({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
