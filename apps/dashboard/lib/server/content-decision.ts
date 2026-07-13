import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { postizAutomationRuntimeReady } from "@/lib/server/automation-management";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";

type Decision = "approved" | "rejected";

interface DecisionInput {
  decision: Decision;
  rejectionReason: string | null;
}

class DecisionRequestError extends Error {
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
    throw new DecisionRequestError("valid_idempotency_key_required", 400);
  }
  return key;
}

async function decisionInput(request: NextRequest): Promise<DecisionInput> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new DecisionRequestError("invalid_json", 400);
  }

  if (!body || typeof body !== "object") {
    throw new DecisionRequestError("invalid_decision", 400);
  }
  const record = body as Record<string, unknown>;
  if (record.decision !== "approved" && record.decision !== "rejected") {
    throw new DecisionRequestError("invalid_decision", 400);
  }

  const reason = typeof record.rejection_reason === "string"
    ? record.rejection_reason.trim()
    : "";
  if (record.decision === "rejected" && !reason) {
    throw new DecisionRequestError("rejection_reason_required", 400);
  }
  if (record.decision === "approved" && reason) {
    throw new DecisionRequestError("approval_cannot_have_rejection_reason", 400);
  }

  return {
    decision: record.decision,
    rejectionReason: reason || null,
  };
}

function fingerprint(contentItemId: string, input: DecisionInput) {
  const canonical = JSON.stringify({
    content_item_id: contentItemId,
    decision: input.decision,
    rejection_reason: input.rejectionReason,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export async function decideContent(request: NextRequest, contentItemId: string) {
  try {
    enforceSameOriginForCookieMutation(request);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contentItemId)) {
      throw new DecisionRequestError("invalid_content_item_id", 400);
    }

    const [user, input] = await Promise.all([
      authorize(request, ["owner", "reviewer"]),
      decisionInput(request),
    ]);
    const key = idempotencyKey(request);
    const requestHash = fingerprint(contentItemId, input);
    const client = await database().connect();

    try {
      await client.query("BEGIN");
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO tanaghom.api_idempotency_keys (
           actor_user_id, operation_type, idempotency_key, request_hash
         ) VALUES ($1, 'content.decision', $2, $3)
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
              AND operation_type = 'content.decision'
              AND idempotency_key = $2`,
          [user.id, key],
        );
        const replay = existing.rows[0];
        if (!replay || replay.request_hash !== requestHash) {
          throw new DecisionRequestError("idempotency_key_reused", 409);
        }
        if (replay.status !== "completed" || !replay.response_status || !replay.response_body) {
          throw new DecisionRequestError("decision_in_progress", 409);
        }
        await client.query("COMMIT");
        const response = noStore(replay.response_body, { status: replay.response_status });
        response.headers.set("Idempotency-Replayed", "true");
        return response;
      }

      const content = await client.query<{ campaign_id: string; status: string }>(
        `SELECT campaign_id, status
           FROM tanaghom.content_items
          WHERE id = $1
          FOR UPDATE`,
        [contentItemId],
      );
      if (!content.rows[0]) throw new DecisionRequestError("content_not_found", 404);
      if (content.rows[0].status !== "pending_approval") {
        throw new DecisionRequestError("content_not_pending_approval", 409);
      }

      const correlationId = randomUUID();
      const approval = await client.query<{ id: string; decided_at: string }>(
        `INSERT INTO tanaghom.content_approvals (
           content_item_id, decision, decided_by, rejection_reason
         ) VALUES ($1, $2, $3, $4)
         RETURNING id, decided_at`,
        [contentItemId, input.decision, user.id, input.rejectionReason],
      );
      await client.query(
        `UPDATE tanaghom.content_items
            SET status = $2
          WHERE id = $1`,
        [contentItemId, input.decision],
      );
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log (
           correlation_id, actor_user_id, action_type, entity_type, entity_id,
           payload, result
         ) VALUES ($1, $2, $3, 'content_item', $4, $5::jsonb, 'success')`,
        [
          correlationId,
          user.id,
          `content.${input.decision}`,
          contentItemId,
          JSON.stringify({
            approval_id: approval.rows[0].id,
            campaign_id: content.rows[0].campaign_id,
            rejection_reason: input.rejectionReason,
          }),
        ],
      );
      await client.query(
        `INSERT INTO tanaghom.outbox_events (
           correlation_id, event_key, event_type, aggregate_type, aggregate_id,
           payload
         ) VALUES ($1, $2, $3, 'content_item', $4, $5::jsonb)`,
        [
          correlationId,
          `content-decision:${approval.rows[0].id}`,
          `content.${input.decision}`,
          contentItemId,
          JSON.stringify({
            content_item_id: contentItemId,
            campaign_id: content.rows[0].campaign_id,
            approval_id: approval.rows[0].id,
          }),
        ],
      );

      const automaticDraft = input.decision === "approved"
        ? (await client.query<{ queued: boolean; reason: string; job_id: string | null }>(
            "SELECT * FROM tanaghom.maybe_queue_automatic_postiz_draft($1::uuid, $2::uuid, $3::boolean)",
            [contentItemId, user.id, postizAutomationRuntimeReady()],
          )).rows[0]
        : { queued: false, reason: "not_approved", job_id: null };

      const responseBody = {
        ok: true,
        content_item_id: contentItemId,
        decision: input.decision,
        approval_id: approval.rows[0].id,
        correlation_id: correlationId,
        decided_at: approval.rows[0].decided_at,
        delivery: "queued",
        postiz_draft: automaticDraft,
      };
      await client.query(
        `UPDATE tanaghom.api_idempotency_keys
            SET status = 'completed', response_status = 200,
                response_body = $2::jsonb, completed_at = now()
          WHERE id = $1`,
        [reservation.rows[0].id, JSON.stringify(responseBody)],
      );
      await client.query("COMMIT");
      return noStore(responseBody);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof DecisionRequestError) {
      return noStore({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
