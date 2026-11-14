import "server-only";

import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";

// A new tenant has no capacity or delivery projection row yet. Return a safe
// operational baseline instead of `undefined`, so the monitoring page can render.
const capacityDefaults = {
  queue_depth: 0,
  urgent_depth: 0,
  interactive_depth: 0,
  background_depth: 0,
  processing_count: 0,
  dead_letter_count: 0,
  oldest_queue_age_seconds: 0,
  ghl_action_queue_depth: 0,
  ghl_actions_in_flight: 0,
  indeterminate_actions: 0,
  max_conversation_concurrency: 0,
  max_model_claims_per_minute: 0,
  max_ghl_action_concurrency: 0,
  max_ghl_actions_per_minute: 0,
  interactive_backlog_threshold: 0,
  queue_age_warning_seconds: 0,
  gemma_blocked_until: null,
  ghl_blocked_until: null,
  capacity_state: "normal",
};

const deliveryDefaults = {
  configured_destinations: 0,
  selected_destinations: 0,
  runtime_ready: false,
  emergency_stop: true,
  reason: "Notification delivery is not configured for this workspace yet.",
  delivery_ready: false,
  last_configured_at: null,
};

// Runtime controls are derived from deployment configuration. The API role does
// not have SELECT permission on automation_platform_controls, so reading that
// table would abort the whole read-only transaction.
function platformControls() {
  const postizReady = process.env.POSTIZ_AUTOMATION_RUNTIME_READY === "true";
  const ghlReady = process.env.GHL_ACTION_RUNTIME_READY === "true";
  return [
    {
      provider: "postiz",
      emergency_stop: !postizReady,
      reason: postizReady
        ? "Draft handoff runtime enabled."
        : "Draft-only mode enforced; external publishing requires human approval.",
    },
    {
      provider: "ghl",
      emergency_stop: !ghlReady,
      reason: ghlReady
        ? "CRM runtime enabled."
        : "Proposal-only mode enforced; automatic CRM actions are disabled.",
    },
  ];
}

export async function getSystemMonitoring(request: NextRequest) {
  const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
  const client = await database().connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const capacity = await client.query(
      `SELECT queue_depth::int,urgent_depth::int,interactive_depth::int,background_depth::int,
              processing_count::int,dead_letter_count::int,oldest_queue_age_seconds::int,
              ghl_action_queue_depth::int,ghl_actions_in_flight::int,indeterminate_actions::int,
              max_conversation_concurrency,max_model_claims_per_minute,
              max_ghl_action_concurrency,max_ghl_actions_per_minute,
              interactive_backlog_threshold,queue_age_warning_seconds,
              gemma_blocked_until,ghl_blocked_until,capacity_state
         FROM tanaghom.conversation_capacity_status WHERE organization_id=$1::uuid`,
      [user.organizationId],
    );
    const delivery = await client.query(
      `SELECT configured_destinations,selected_destinations,runtime_ready,emergency_stop,
              reason,delivery_ready,last_configured_at
         FROM tanaghom.notification_delivery_status WHERE organization_id=$1::uuid`,
      [user.organizationId],
    );
    const connections = await client.query(
      `SELECT provider,status,last_tested_at,last_test_status,last_error_code,updated_at
         FROM tanaghom.integration_connection_status
        WHERE organization_id=$1::uuid ORDER BY provider`,
      [user.organizationId],
    );
    const agents = await client.query(
      `SELECT agent.code,agent.name,agent.status,agent.last_heartbeat_at,
              count(job.id) FILTER (WHERE job.status='running')::int AS running_jobs
         FROM tanaghom.agents agent
         LEFT JOIN tanaghom.agent_jobs job ON job.agent_id=agent.id
          AND job.status='running'
          AND (job.input->>'organization_id'=$1::text OR job.campaign_id IN (
            SELECT id FROM tanaghom.campaigns WHERE organization_id=$1::uuid
          ))
        GROUP BY agent.id ORDER BY agent.created_at`,
      [user.organizationId],
    );
    const alerts = await client.query(
      `SELECT notification.id,notification.severity,notification.title,notification.body,
              notification.entity_type,notification.entity_id,notification.created_at
         FROM tanaghom.notifications notification
        WHERE notification.read_at IS NULL AND notification.user_id IN (
          SELECT id FROM tanaghom.app_users WHERE organization_id=$1::uuid
        ) ORDER BY notification.created_at DESC LIMIT 20`,
      [user.organizationId],
    );
    await client.query("COMMIT");
    const capacityRow = capacity.rows[0];
    const capacitySnapshot = capacityRow
      ? { ...capacityRow, social_publishing_review: capacityRow.indeterminate_actions }
      : { ...capacityDefaults, social_publishing_review: 0 };
    return {
      observed_at: new Date().toISOString(),
      viewer: { role: user.role, can_manage_notifications: user.role === "owner" },
      capacity: capacitySnapshot,
      notification_delivery: delivery.rows[0] ?? deliveryDefaults,
      connections: connections.rows,
      agents: agents.rows,
      alerts: alerts.rows,
      platform_controls: platformControls(),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
