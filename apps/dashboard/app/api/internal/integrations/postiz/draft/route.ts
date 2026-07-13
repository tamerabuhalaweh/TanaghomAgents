import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { database } from "@/lib/server/database";
import { decryptCredential } from "@/lib/server/integration-crypto";
import { createPostizDraft, validateProviderBaseUrl } from "@/lib/server/integration-providers";
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
  let body: { job_id?: unknown; request_body?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return noStore({ error: "invalid_json" }, { status: 400 }); }
  if (typeof body.job_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.job_id) || !body.request_body || typeof body.request_body !== "object") {
    return noStore({ error: "invalid_gateway_request" }, { status: 400 });
  }

  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      operation_id: string;
      base_url: string;
      credential_ciphertext: Buffer;
      credential_nonce: Buffer;
      credential_auth_tag: Buffer;
      credential_key_version: number;
    }>(
      `SELECT operation.id AS operation_id, connection.base_url, connection.credential_ciphertext,
              connection.credential_nonce, connection.credential_auth_tag,
              connection.credential_key_version
         FROM tanaghom.agent_jobs job
         JOIN tanaghom.campaigns campaign ON campaign.id = job.campaign_id
         JOIN tanaghom.integration_connections connection
           ON connection.organization_id = campaign.organization_id
          AND connection.provider = 'postiz'
          AND connection.status = 'connected'
         JOIN tanaghom.organization_automation_policies policy
           ON policy.organization_id = campaign.organization_id
          AND policy.postiz_draft_mode IN ('manual', 'automatic')
         JOIN tanaghom.automation_platform_controls control
           ON control.provider = 'postiz'
          AND NOT control.emergency_stop
         JOIN tanaghom.external_operations operation
           ON operation.correlation_id = job.correlation_id
          AND operation.provider = 'postiz'
          AND operation.operation_type = 'create_draft'
          AND operation.status = 'in_progress'
          AND operation.response_summary IS NULL
          AND operation.request_fingerprint = 'md5:' || md5($2::jsonb::text)
        WHERE job.id = $1
          AND job.job_type = 'content.postiz.draft'
          AND job.status = 'running'
          AND NOT EXISTS (
            SELECT 1
            FROM tanaghom.external_operations uncertain_operation
            JOIN tanaghom.agent_jobs uncertain_job
              ON uncertain_job.correlation_id = uncertain_operation.correlation_id
            JOIN tanaghom.campaigns uncertain_campaign
              ON uncertain_campaign.id = uncertain_job.campaign_id
            WHERE uncertain_campaign.organization_id = campaign.organization_id
              AND uncertain_operation.provider = 'postiz'
              AND uncertain_operation.status = 'indeterminate'
          )
        FOR UPDATE OF operation`,
      [body.job_id, JSON.stringify(body.request_body)],
    );
    const connection = result.rows[0];
    if (!connection) {
      await client.query("ROLLBACK");
      return noStore({ error: "gateway_operation_not_authorized" }, { status: 409 });
    }
    await client.query(
      `UPDATE tanaghom.external_operations
          SET response_summary = jsonb_build_object(
            'gateway_dispatched_at', statement_timestamp()
          )
        WHERE id = $1`,
      [connection.operation_id],
    );
    await client.query("COMMIT");

    const baseUrl = validateProviderBaseUrl("postiz", connection.base_url);
    const secret = decryptCredential(connection);
    const providerResponse = await createPostizDraft(baseUrl, secret, body.request_body);
    return noStore(providerResponse.body, { status: providerResponse.statusCode });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
      ? error.message : "integration_gateway_unavailable";
    return noStore({ error: { message: code } }, { status: 502 });
  } finally { client.release(); }
}
