import "server-only";

import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";

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
         FROM tanaghom.conversation_capacity_status WHERE organization_id=$1`,
      [user.organizationId],
    );
    const delivery = await client.query(
      `SELECT configured_destinations,selected_destinations,runtime_ready,emergency_stop,
              reason,delivery_ready,last_configured_at
         FROM tanaghom.notification_delivery_status WHERE organization_id=$1`,
      [user.organizationId],
    );
    const connections = await client.query(
      `SELECT provider,status,last_tested_at,last_test_status,last_error_code,updated_at
         FROM tanaghom.integration_connection_status
        WHERE organization_id=$1 ORDER BY provider`,
      [user.organizationId],
    );
    const agents = await client.query(
      `SELECT agent.code,agent.name,agent.status,agent.last_heartbeat_at,
              count(job.id) FILTER (WHERE job.status='running')::int AS running_jobs
         FROM tanaghom.agents agent
         LEFT JOIN tanaghom.agent_jobs job ON job.agent_id=agent.id
          AND job.status='running'
          AND (job.input->>'organization_id'=$1::text OR job.campaign_id IN (
            SELECT id FROM tanaghom.campaigns WHERE organization_id=$1
          ))
        GROUP BY agent.id ORDER BY agent.created_at`,
      [user.organizationId],
    );
    const alerts = await client.query(
      `SELECT notification.id,notification.severity,notification.title,notification.body,
              notification.entity_type,notification.entity_id,notification.created_at
         FROM tanaghom.notifications notification
        WHERE notification.read_at IS NULL AND (
          notification.user_id IS NULL OR notification.user_id IN (
            SELECT id FROM tanaghom.app_users WHERE organization_id=$1
          )
        ) ORDER BY notification.created_at DESC LIMIT 20`,
      [user.organizationId],
    );
    const controls = await client.query(
      `SELECT provider,emergency_stop,reason,updated_at
         FROM tanaghom.automation_platform_controls ORDER BY provider`,
    );
    await client.query("COMMIT");
    return {
      observed_at: new Date().toISOString(),
      viewer: { role: user.role, can_manage_notifications: user.role === "owner" },
      capacity: capacity.rows[0],
      notification_delivery: delivery.rows[0],
      connections: connections.rows,
      agents: agents.rows,
      alerts: alerts.rows,
      platform_controls: controls.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
