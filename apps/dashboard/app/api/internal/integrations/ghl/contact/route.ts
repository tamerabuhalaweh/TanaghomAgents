import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { database } from "@/lib/server/database";
import { decryptCredential } from "@/lib/server/integration-crypto";
import { upsertGhlContact, validateProviderBaseUrl } from "@/lib/server/integration-providers";
import { noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

function workerAuthorized(request: NextRequest) {
  const configured = process.env.INTEGRATION_WORKER_TOKEN || "";
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (configured.length < 32 || supplied.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
}

function validRequestBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const allowed = new Set(["name", "email", "phone", "locationId", "source", "createNewIfDuplicateAllowed"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return false;
  if (typeof body.locationId !== "string" || !/^[A-Za-z0-9_-]{3,100}$/.test(body.locationId)) return false;
  if (body.source !== "Tanaghom" || body.createNewIfDuplicateAllowed !== false) return false;
  if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > 300)) return false;
  if (body.email !== undefined && (typeof body.email !== "string" || body.email.length > 320)) return false;
  if (body.phone !== undefined && (typeof body.phone !== "string" || body.phone.length > 80)) return false;
  return (typeof body.email === "string" && body.email.trim().length > 0)
    || (typeof body.phone === "string" && body.phone.trim().length > 0);
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return noStore({ error: "worker_authentication_required" }, { status: 401 });
  if (process.env.GHL_CONTACT_SYNC_ENABLED !== "true") {
    return noStore({ error: "ghl_contact_sync_disabled" }, { status: 503 });
  }
  let body: { job_id?: unknown; request_body?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return noStore({ error: "invalid_json" }, { status: 400 }); }
  if (typeof body.job_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.job_id)
      || !validRequestBody(body.request_body)) {
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
      `SELECT operation.id AS operation_id, connection.base_url,
              connection.credential_ciphertext, connection.credential_nonce,
              connection.credential_auth_tag, connection.credential_key_version
         FROM tanaghom.agent_jobs job
         JOIN tanaghom.campaigns campaign ON campaign.id = job.campaign_id
         JOIN tanaghom.integration_connections connection
           ON connection.organization_id = campaign.organization_id
          AND connection.provider = 'ghl' AND connection.status = 'connected'
          AND connection.configuration->>'location_id' = $3
         JOIN tanaghom.organization_crm_policies policy
           ON policy.organization_id = campaign.organization_id
          AND policy.contact_sync_mode = 'manual'
         JOIN tanaghom.automation_platform_controls control
           ON control.provider = 'ghl' AND NOT control.emergency_stop
         JOIN tanaghom.external_operations operation
           ON operation.correlation_id = job.correlation_id
          AND operation.provider = 'ghl'
          AND operation.operation_type = 'upsert_contact'
          AND operation.status = 'in_progress'
          AND operation.response_summary IS NULL
          AND operation.request_fingerprint = 'md5:' || md5($2::jsonb::text)
        WHERE job.id = $1 AND job.job_type = 'lead.ghl.contact_upsert'
          AND job.status = 'running'
          AND NOT EXISTS (
            SELECT 1 FROM tanaghom.external_operations uncertain_operation
            JOIN tanaghom.agent_jobs uncertain_job
              ON uncertain_job.correlation_id = uncertain_operation.correlation_id
            JOIN tanaghom.campaigns uncertain_campaign
              ON uncertain_campaign.id = uncertain_job.campaign_id
            WHERE uncertain_campaign.organization_id = campaign.organization_id
              AND uncertain_operation.provider = 'ghl'
              AND uncertain_operation.status = 'indeterminate'
          )
        FOR UPDATE OF operation`,
      [body.job_id, JSON.stringify(body.request_body), body.request_body.locationId],
    );
    const connection = result.rows[0];
    if (!connection) {
      await client.query("ROLLBACK");
      return noStore({ error: "gateway_operation_not_authorized" }, { status: 409 });
    }
    await client.query(
      `UPDATE tanaghom.external_operations
          SET response_summary = jsonb_build_object('gateway_dispatched_at', statement_timestamp())
        WHERE id = $1`,
      [connection.operation_id],
    );
    await client.query("COMMIT");

    const baseUrl = validateProviderBaseUrl("ghl", connection.base_url);
    const secret = decryptCredential(connection);
    const providerResponse = await upsertGhlContact(baseUrl, secret, body.request_body);
    return noStore(providerResponse.body, { status: providerResponse.statusCode });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
      ? error.message : "integration_gateway_unavailable";
    return noStore({ error: { message: code } }, { status: 502 });
  } finally { client.release(); }
}
