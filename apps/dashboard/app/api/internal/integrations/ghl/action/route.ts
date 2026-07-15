import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { database } from "@/lib/server/database";
import { decryptCredential } from "@/lib/server/integration-crypto";
import {
  executeGhlAction,
  validateGhlActionDispatch,
  validateProviderBaseUrl,
} from "@/lib/server/integration-providers";
import { noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

function workerAuthorized(request: NextRequest) {
  const configured = process.env.INTEGRATION_WORKER_TOKEN || "";
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (configured.length < 32 || supplied.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return noStore({ error: "worker_authentication_required" }, { status: 401 });
  if (process.env.GHL_ACTION_RUNTIME_ENABLED !== "true") {
    return noStore({ error: "ghl_action_runtime_disabled" }, { status: 503 });
  }
  let body: { job_id?: unknown; operation_id?: unknown; request_body?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return noStore({ error: "invalid_json" }, { status: 400 }); }
  if (typeof body.job_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.job_id)
      || typeof body.operation_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.operation_id)) {
    return noStore({ error: "invalid_gateway_request" }, { status: 400 });
  }
  let dispatch;
  try { dispatch = validateGhlActionDispatch(body.request_body); }
  catch { return noStore({ error: "ghl_action_request_invalid" }, { status: 400 }); }
  const idempotencyKey = request.headers.get("idempotency-key") || "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 300) {
    return noStore({ error: "invalid_idempotency_key" }, { status: 400 });
  }

  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      base_url: string;
      location_id: string;
      credential_ciphertext: Buffer;
      credential_nonce: Buffer;
      credential_auth_tag: Buffer;
      credential_key_version: number;
    }>(
      `SELECT connection.base_url, connection.configuration->>'location_id' AS location_id,
              connection.credential_ciphertext, connection.credential_nonce,
              connection.credential_auth_tag, connection.credential_key_version
         FROM tanaghom.ghl_action_jobs job
         JOIN tanaghom.conversations conversation ON conversation.id=job.conversation_id
         JOIN tanaghom.organization_crm_policies policy ON policy.organization_id=job.organization_id
         JOIN tanaghom.automation_platform_controls control ON control.provider='ghl'
         JOIN tanaghom.integration_connections connection ON connection.organization_id=job.organization_id
          AND connection.provider='ghl' AND connection.status='connected'
         JOIN tanaghom.external_operations operation ON operation.id=job.external_operation_id
          AND operation.provider='ghl' AND operation.status='in_progress'
          AND operation.response_summary IS NULL
        WHERE job.id=$1 AND operation.id=$2 AND job.status='dispatching'
          AND job.action_type=$3 AND job.idempotency_key=$4
          AND operation.idempotency_key=$4
          AND operation.request_fingerprint='md5:'||md5($5::jsonb::text)
          AND NOT control.emergency_stop AND NOT policy.action_emergency_stop
          AND NOT conversation.emergency_paused AND conversation.ownership_epoch=job.ownership_epoch
          AND conversation.state NOT IN ('paused','resolved','failed')
          AND (job.action_type<>'message' OR
            (job.requested_by_user_id IS NOT NULL AND conversation.state='human_owned'
              AND conversation.reply_authority='human' AND conversation.owner_user_id=job.requested_by_user_id)
            OR (job.requested_by_agent_id IS NOT NULL AND conversation.state='ai_owned'
              AND conversation.reply_authority='ai' AND conversation.lease_token=job.lease_token
              AND conversation.lease_expires_at>statement_timestamp()))
          AND NOT EXISTS (SELECT 1 FROM tanaghom.ghl_action_jobs uncertain
            WHERE uncertain.organization_id=job.organization_id AND uncertain.status='indeterminate')
        FOR UPDATE OF operation`,
      [body.job_id, body.operation_id, dispatch.action_type, idempotencyKey, JSON.stringify(dispatch)],
    );
    const connection = result.rows[0];
    if (!connection || !/^[A-Za-z0-9_-]{3,100}$/.test(connection.location_id || "")) {
      await client.query("ROLLBACK");
      return noStore({ error: "gateway_operation_not_authorized" }, { status: 409 });
    }
    await client.query(
      `UPDATE tanaghom.external_operations
          SET response_summary=jsonb_build_object('gateway_dispatched_at',statement_timestamp())
        WHERE id=$1`,
      [body.operation_id],
    );
    await client.query("COMMIT");

    const baseUrl = validateProviderBaseUrl("ghl", connection.base_url);
    const secret = decryptCredential(connection);
    const providerResponse = await executeGhlAction(baseUrl, secret, dispatch, connection.location_id);
    return noStore(providerResponse.body, { status: providerResponse.statusCode });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
      ? error.message : "integration_gateway_unavailable";
    return noStore({ error: { message: code } }, { status: 502 });
  } finally { client.release(); }
}
