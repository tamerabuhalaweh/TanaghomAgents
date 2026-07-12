import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const client = await database().connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const summary = await client.query(
        `SELECT
           (SELECT count(*)::int FROM tanaghom.campaigns) AS campaigns_total,
           (SELECT count(*)::int FROM tanaghom.campaigns WHERE status = 'active') AS campaigns_active,
           (SELECT count(*)::int FROM tanaghom.content_items WHERE status = 'pending_approval') AS approvals_pending,
           (SELECT count(*)::int FROM tanaghom.agent_jobs WHERE status IN ('queued', 'running', 'waiting_approval')) AS jobs_open,
           (SELECT count(*)::int FROM tanaghom.leads) AS leads_total,
           (SELECT count(*)::int FROM tanaghom.leads WHERE status = 'won') AS leads_won,
           (SELECT count(*)::int FROM tanaghom.notifications WHERE read_at IS NULL) AS notifications_unread`,
      );
      const campaigns = await client.query(
        `SELECT campaign.id, campaign.name, campaign.product_type, campaign.status,
                campaign.blocked_reason, campaign.budget_target, campaign.revenue_target,
                campaign.currency, campaign.created_at, campaign.updated_at,
                count(DISTINCT content.id)::int AS content_total,
                count(DISTINCT content.id) FILTER (WHERE content.status = 'pending_approval')::int AS content_pending,
                count(DISTINCT lead.id)::int AS leads_total
           FROM tanaghom.campaigns AS campaign
           LEFT JOIN tanaghom.content_items AS content ON content.campaign_id = campaign.id
           LEFT JOIN tanaghom.leads AS lead ON lead.campaign_id = campaign.id
          GROUP BY campaign.id
          ORDER BY campaign.updated_at DESC
          LIMIT 100`,
      );
      const agents = await client.query(
        `SELECT agent.id, agent.code, agent.name, agent.description, agent.status,
                agent.last_heartbeat_at,
                job.id AS current_job_id, job.job_type AS current_job_type,
                job.status AS current_job_status, job.campaign_id,
                job.started_at AS current_job_started_at
           FROM tanaghom.agents AS agent
           LEFT JOIN LATERAL (
             SELECT id, job_type, status, campaign_id, started_at
               FROM tanaghom.agent_jobs
              WHERE agent_id = agent.id
                AND status IN ('queued', 'running', 'waiting_approval')
              ORDER BY created_at DESC
              LIMIT 1
           ) AS job ON true
          ORDER BY agent.created_at ASC`,
      );
      const leads = await client.query(
        `SELECT lead.id, lead.campaign_id, campaign.name AS campaign_name,
                lead.name, lead.contact_email, lead.contact_phone, lead.status,
                lead.temperature, lead.available_for_requeue, lead.created_at,
                lead.last_touch_at
           FROM tanaghom.leads AS lead
           JOIN tanaghom.campaigns AS campaign ON campaign.id = lead.campaign_id
          ORDER BY lead.created_at DESC
          LIMIT 100`,
      );
      const performance = await client.query(
        `SELECT coalesce(sum(impressions), 0)::bigint AS impressions,
                coalesce(sum(clicks), 0)::bigint AS clicks,
                coalesce(sum(spend), 0)::numeric AS spend,
                count(*) FILTER (WHERE status = 'live')::int AS live_posts,
                count(*) FILTER (WHERE status = 'failed')::int AS failed_posts
           FROM tanaghom.posts`,
      );
      const notifications = await client.query(
        `SELECT id, severity, title, body, entity_type, entity_id, created_at
           FROM tanaghom.notifications
          WHERE read_at IS NULL
          ORDER BY created_at DESC
          LIMIT 50`,
      );
      await client.query("COMMIT");

      return noStore({
        summary: summary.rows[0],
        campaigns: campaigns.rows,
        agents: agents.rows,
        leads: leads.rows,
        performance: performance.rows[0],
        notifications: notifications.rows,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return apiFailure(error);
  }
}
