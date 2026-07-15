import "server-only";

import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";

export class GhlActionReviewError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum + 1) : "";
}

function uuid(value: unknown) {
  const candidate = text(value, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate : "";
}

function mapDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/reconciliation command conflict/i.test(message)) {
    return new GhlActionReviewError("ghl_reconciliation_conflict", 409);
  }
  if (/valid human GHL reconciliation|required.*reconciliation|indeterminate organization GHL action required/i.test(message)) {
    return new GhlActionReviewError("ghl_reconciliation_rejected", 409);
  }
  if (/policy no longer permits|emergency|connected GHL|indeterminate GHL action exists/i.test(message)) {
    return new GhlActionReviewError("ghl_action_policy_blocked", 409);
  }
  if (/valid human GHL action decision|not.*awaiting/i.test(message)) {
    return new GhlActionReviewError("ghl_action_decision_rejected", 409);
  }
  return error;
}

export async function listGhlActionReview(request: NextRequest) {
  const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
  const result = await database().query(
    `SELECT job.id,job.action_type,job.direction,job.channel,job.payload,job.policy_snapshot,
      job.status,job.idempotency_key,job.ownership_epoch,job.attempt,job.max_attempts,
      job.created_at,job.dispatched_at,job.finished_at,job.error_code,job.error_message,
      job.provider_reference,job.request_fingerprint,conversation.provider_conversation_id,
      conversation.state AS conversation_state,conversation.reply_authority,
      lead.name AS lead_name,lead.contact_email,lead.contact_phone,
      requester.display_name AS requested_by_name,agent.display_name AS requested_by_agent_name,
      template.template_key,template.version AS template_version,template.body AS template_body,
      operation.id AS operation_id,operation.status AS operation_status,
      operation.response_summary AS operation_response_summary,
      reconciliation.resolution,reconciliation.reason AS reconciliation_reason,
      reconciler.display_name AS reconciled_by_name,reconciliation.reconciled_at
     FROM tanaghom.ghl_action_jobs job
     JOIN tanaghom.conversations conversation ON conversation.id=job.conversation_id
     LEFT JOIN tanaghom.leads lead ON lead.id=job.lead_id
     LEFT JOIN tanaghom.app_users requester ON requester.id=job.requested_by_user_id
     LEFT JOIN tanaghom.app_users agent ON agent.id=job.requested_by_agent_id
     LEFT JOIN tanaghom.ghl_message_template_versions template ON template.id=job.template_version_id
     LEFT JOIN tanaghom.external_operations operation ON operation.id=job.external_operation_id
     LEFT JOIN tanaghom.ghl_action_reconciliations reconciliation ON reconciliation.action_job_id=job.id
     LEFT JOIN tanaghom.app_users reconciler ON reconciler.id=reconciliation.reconciled_by
     WHERE job.organization_id=$1 AND job.status IN ('awaiting_approval','indeterminate')
     ORDER BY CASE job.status WHEN 'indeterminate' THEN 1 ELSE 2 END,job.created_at,job.id
     LIMIT 250`,
    [user.organizationId],
  );
  return {
    items: result.rows,
    current_user: { id: user.id, name: user.displayName, role: user.role },
    snapshot_at: new Date().toISOString(),
    stale_after_seconds: 30,
  };
}

export async function decideGhlAction(request: NextRequest, jobId: string) {
  enforceSameOriginForCookieMutation(request);
  const user = await authorize(request, ["owner", "reviewer"]);
  if (!uuid(jobId)) throw new GhlActionReviewError("ghl_action_id_invalid");
  const body = await request.json() as Record<string, unknown>;
  const decision = text(body.decision, 20);
  const reason = text(body.reason, 1000);
  const commandId = uuid(body.command_id);
  if (!new Set(["approved", "rejected"]).has(decision) || reason.length < 3 || !commandId) {
    throw new GhlActionReviewError("ghl_action_decision_invalid");
  }
  try {
    const result = await database().query(
      "SELECT tanaghom.decide_ghl_action($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid) AS status",
      [jobId, user.id, decision, reason, commandId],
    );
    return { id: jobId, status: result.rows[0].status, decision };
  } catch (error) { throw mapDatabaseError(error); }
}

export async function reconcileGhlAction(request: NextRequest, jobId: string) {
  enforceSameOriginForCookieMutation(request);
  const user = await authorize(request, ["owner", "reviewer"]);
  if (!uuid(jobId)) throw new GhlActionReviewError("ghl_action_id_invalid");
  const body = await request.json() as Record<string, unknown>;
  const resolution = text(body.resolution, 40);
  const reason = text(body.reason, 1000);
  const providerReference = body.provider_reference == null ? null : text(body.provider_reference, 300);
  const commandId = uuid(body.command_id);
  if (!new Set(["confirmed_succeeded", "confirmed_not_applied"]).has(resolution)
      || reason.length < 3 || !commandId || (body.provider_reference != null && !providerReference)) {
    throw new GhlActionReviewError("ghl_reconciliation_invalid");
  }
  try {
    const result = await database().query(
      "SELECT tanaghom.reconcile_ghl_action($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::uuid) AS status",
      [jobId, user.id, resolution, reason, providerReference, commandId],
    );
    return { id: jobId, status: result.rows[0].status, resolution };
  } catch (error) { throw mapDatabaseError(error); }
}
