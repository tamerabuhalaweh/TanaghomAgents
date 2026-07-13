import "server-only";

import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize, type ApplicationRole } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";

const transitionActions = new Set(["takeover", "assign", "reassign", "pause", "resolve", "resume_ai"]);

export class ConversationRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function value(input: unknown, maximum: number) {
  return typeof input === "string" ? input.trim().slice(0, maximum + 1) : "";
}

function uuid(input: unknown) {
  const text = value(input, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/stale conversation version/i.test(message)) return new ConversationRequestError("conversation_stale", 409);
  if (/authority|ownership|assignment|assignee|current state|resolved|organization conversation/i.test(message)) {
    return new ConversationRequestError("conversation_transition_rejected", 409);
  }
  return error;
}

export async function listSupervisorConversations(request: NextRequest) {
  const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
  const [inbox, users, policy, notifications] = await Promise.all([
    database().query(
      `SELECT * FROM tanaghom.conversation_supervisor_inbox
       WHERE organization_id=$1
       ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         sla_breached DESC, sla_due_at, last_activity_at DESC LIMIT 250`,
      [user.organizationId],
    ),
    database().query(
      `SELECT id,display_name,role FROM tanaghom.app_users WHERE organization_id=$1
       AND kind='human' AND role IN ('owner','reviewer','operator') AND is_active AND accepted_at IS NOT NULL
       ORDER BY display_name`,
      [user.organizationId],
    ),
    database().query(
      `SELECT conversation_emergency_stop,conversation_emergency_reason,
        conversation_emergency_changed_at,conversation_processing_mode
       FROM tanaghom.organization_crm_policies WHERE organization_id=$1`,
      [user.organizationId],
    ),
    database().query(
      `SELECT count(*)::int AS unread FROM tanaghom.notifications notification
       JOIN tanaghom.app_users app ON app.id=notification.user_id
       WHERE app.organization_id=$1 AND notification.entity_type='conversation' AND notification.read_at IS NULL`,
      [user.organizationId],
    ),
  ]);
  return {
    conversations: inbox.rows,
    assignees: users.rows,
    policy: policy.rows[0] || null,
    unread_notifications: notifications.rows[0]?.unread || 0,
    current_user: { id: user.id, name: user.displayName, role: user.role },
    snapshot_at: new Date().toISOString(),
    stale_after_seconds: 30,
  };
}

async function conversationForUser(request: NextRequest, conversationId: string) {
  const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
  if (!uuid(conversationId)) throw new ConversationRequestError("conversation_id_invalid");
  const result = await database().query(
    `SELECT * FROM tanaghom.conversation_supervisor_inbox WHERE id=$1 AND organization_id=$2`,
    [conversationId, user.organizationId],
  );
  if (!result.rows[0]) throw new ConversationRequestError("conversation_not_found", 404);
  return { user, conversation: result.rows[0] as Record<string, unknown> };
}

export async function getSupervisorConversation(request: NextRequest, conversationId: string) {
  const { user, conversation } = await conversationForUser(request, conversationId);
  const providerConversationId = conversation.provider_conversation_id as string;
  const [messages, proposals, ownership, drafts, operations] = await Promise.all([
    database().query(
      `SELECT id,occurred_at AS at,'message' AS kind,direction,channel,provider_event_type,
        left(coalesce(payload->'details'->>'body',''),4000) AS body,status,last_error_code,last_error_message
       FROM tanaghom.ghl_inbound_events WHERE organization_id=$1 AND conversation_id=$2
       ORDER BY occurred_at,id`,
      [user.organizationId, providerConversationId],
    ),
    database().query(
      `SELECT proposal.id,proposal.created_at AS at,'proposal' AS kind,proposal.language,
        proposal.intent,proposal.urgency,proposal.sentiment,proposal.sales_stage,
        proposal.next_best_action,proposal.confidence,proposal.answer_status,
        proposal.proposed_reply,proposal.citations,proposal.risk_categories,
        proposal.escalation_required,proposal.escalation_category,proposal.escalation_reason,
        summary.summary AS handoff_summary
       FROM tanaghom.conversation_intelligence_proposals proposal
       LEFT JOIN tanaghom.conversation_summary_versions summary ON summary.id=proposal.summary_version_id
       WHERE proposal.organization_id=$1 AND proposal.conversation_id=$2 ORDER BY proposal.created_at,proposal.id`,
      [user.organizationId, providerConversationId],
    ),
    database().query(
      `SELECT history.id,history.occurred_at AS at,'ownership' AS kind,history.action,
        history.previous_state,history.new_state,history.previous_reply_authority,
        history.new_reply_authority,history.reason,history.ownership_epoch,
        actor.display_name AS actor_name,history.actor_role
       FROM tanaghom.conversation_ownership_history history
       LEFT JOIN tanaghom.app_users actor ON actor.id=history.actor_user_id
       WHERE history.organization_id=$1 AND history.conversation_id=$2 ORDER BY history.occurred_at,history.id`,
      [user.organizationId, conversationId],
    ),
    database().query(
      `SELECT draft.id,draft.created_at AS at,'human_draft' AS kind,draft.body,draft.language,
        draft.status,author.display_name AS author_name,draft.ownership_epoch
       FROM tanaghom.conversation_human_reply_drafts draft
       JOIN tanaghom.app_users author ON author.id=draft.author_user_id
       WHERE draft.organization_id=$1 AND draft.conversation_id=$2 ORDER BY draft.created_at,draft.id`,
      [user.organizationId, conversationId],
    ),
    database().query(
      `SELECT operation.id,operation.created_at AS at,'operation' AS kind,operation.provider,
        operation.operation_type,operation.status,operation.provider_reference,
        operation.response_summary,job.error_code,job.error_message
       FROM tanaghom.external_operations operation
       JOIN tanaghom.agent_jobs job ON job.correlation_id=operation.correlation_id
       JOIN tanaghom.ghl_inbound_events event ON event.id=(job.input->>'event_id')::uuid
       WHERE event.organization_id=$1 AND event.conversation_id=$2 ORDER BY operation.created_at,operation.id`,
      [user.organizationId, providerConversationId],
    ),
  ]);
  const timeline = [...messages.rows, ...proposals.rows, ...ownership.rows, ...drafts.rows, ...operations.rows]
    .sort((a, b) => new Date(a.at as string).getTime() - new Date(b.at as string).getTime());
  return { conversation, timeline, snapshot_at: new Date().toISOString(), current_user: { id: user.id, role: user.role } };
}

export async function transitionSupervisorConversation(request: NextRequest, conversationId: string) {
  enforceSameOriginForCookieMutation(request);
  const user = await authorize(request, ["owner", "reviewer", "operator"]);
  if (!uuid(conversationId)) throw new ConversationRequestError("conversation_id_invalid");
  const body = await request.json() as Record<string, unknown>;
  const action = value(body.action, 20);
  const reason = value(body.reason, 1000);
  const assigneeId = body.assignee_id == null ? null : uuid(body.assignee_id);
  const commandId = uuid(body.command_id);
  const expectedVersion = Number(body.expected_version);
  if (!transitionActions.has(action) || reason.length < 3 || !commandId
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1
    || ((action === "assign" || action === "reassign") && !assigneeId)) {
    throw new ConversationRequestError("conversation_transition_invalid");
  }
  try {
    const result = await database().query(
      `SELECT * FROM tanaghom.transition_supervised_conversation($1,$2,$3,$4,$5,$6,$7)`,
      [conversationId, action, user.id, assigneeId, reason, expectedVersion, commandId],
    );
    return result.rows[0];
  } catch (error) { throw databaseError(error); }
}

export async function createHumanReplyDraft(request: NextRequest, conversationId: string) {
  enforceSameOriginForCookieMutation(request);
  const user = await authorize(request, ["owner", "reviewer", "operator"]);
  if (!uuid(conversationId)) throw new ConversationRequestError("conversation_id_invalid");
  const body = await request.json() as Record<string, unknown>;
  const commandId = uuid(body.command_id);
  const expectedEpoch = Number(body.expected_epoch);
  const replyBody = value(body.body, 5000);
  const language = value(body.language, 2);
  if (!commandId || !Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0
    || !replyBody || !["en", "ar"].includes(language)) {
    throw new ConversationRequestError("reply_draft_invalid");
  }
  try {
    const result = await database().query(
      `SELECT tanaghom.create_conversation_human_reply_draft($1,$2,$3,$4,$5,$6) AS id`,
      [conversationId, user.id, expectedEpoch, replyBody, language, commandId],
    );
    return { id: result.rows[0].id, status: "draft", external_action_count: 0 };
  } catch (error) { throw databaseError(error); }
}

export async function setConversationEmergencyStop(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  const body = await request.json() as Record<string, unknown>;
  const active = body.active;
  const reason = value(body.reason, 500);
  const commandId = uuid(body.command_id);
  if (typeof active !== "boolean" || reason.length < 3 || !commandId) {
    throw new ConversationRequestError("emergency_control_invalid");
  }
  const result = await database().query(
    `SELECT tanaghom.set_organization_conversation_emergency_stop($1,$2,$3,$4) AS affected`,
    [active, reason, owner.id, commandId],
  );
  return { active, reason, affected: result.rows[0].affected };
}

export function canMutateConversations(role: ApplicationRole) {
  return role !== "viewer";
}
