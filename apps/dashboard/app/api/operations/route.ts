import type { NextRequest } from "next/server";

import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    const client = await database().connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const summary = await client.query(
        `SELECT
           (SELECT count(*)::int FROM tanaghom.campaigns WHERE organization_id = $1) AS campaigns_total,
           (SELECT count(*)::int FROM tanaghom.campaigns WHERE organization_id = $1 AND status = 'active') AS campaigns_active,
           (SELECT count(*)::int FROM tanaghom.content_items content
             JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
            WHERE campaign.organization_id = $1 AND content.status = 'pending_approval') AS approvals_pending,
           (SELECT count(*)::int FROM tanaghom.agent_jobs job
             JOIN tanaghom.campaigns campaign ON campaign.id = job.campaign_id
            WHERE campaign.organization_id = $1 AND job.status IN ('queued', 'running', 'waiting_approval')) AS jobs_open,
           (SELECT count(*)::int FROM tanaghom.leads lead
             JOIN tanaghom.campaigns campaign ON campaign.id = lead.campaign_id
            WHERE campaign.organization_id = $1) AS leads_total,
           (SELECT count(*)::int FROM tanaghom.leads lead
             JOIN tanaghom.campaigns campaign ON campaign.id = lead.campaign_id
            WHERE campaign.organization_id = $1 AND lead.status = 'won') AS leads_won,
           (SELECT count(*)::int FROM tanaghom.notifications notification
             JOIN tanaghom.app_users app ON app.id = notification.user_id
            WHERE app.organization_id = $1 AND notification.read_at IS NULL) AS notifications_unread`,
        [user.organizationId],
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
          WHERE campaign.organization_id = $1
          GROUP BY campaign.id
          ORDER BY campaign.updated_at DESC
          LIMIT 100`,
        [user.organizationId],
      );
      const agents = await client.query(
        `SELECT agent.id, agent.code, agent.name, agent.description, agent.status,
                agent.last_heartbeat_at,
                job.id AS current_job_id, job.job_type AS current_job_type,
                job.status AS current_job_status, job.campaign_id,
                job.started_at AS current_job_started_at
           FROM tanaghom.agents AS agent
           LEFT JOIN LATERAL (
             SELECT agent_job.id, agent_job.job_type, agent_job.status,
                    agent_job.campaign_id, agent_job.started_at
               FROM tanaghom.agent_jobs agent_job
              JOIN tanaghom.campaigns campaign ON campaign.id = agent_job.campaign_id
              WHERE agent_job.agent_id = agent.id
                AND campaign.organization_id = $1
                AND agent_job.status IN ('queued', 'running', 'waiting_approval')
              ORDER BY agent_job.created_at DESC
              LIMIT 1
           ) AS job ON true
          ORDER BY agent.created_at ASC`,
        [user.organizationId],
      );
      const leads = await client.query(
        `SELECT lead.id, lead.campaign_id, campaign.name AS campaign_name,
                lead.name, lead.contact_email, lead.contact_phone, lead.status,
                lead.temperature, lead.available_for_requeue, lead.created_at,
                lead.last_touch_at, lead.ghl_contact_id,
                sync.status AS ghl_sync_status, sync.last_success_at AS ghl_last_synced_at,
                sync.last_error_code AS ghl_last_error_code
           FROM tanaghom.leads AS lead
           JOIN tanaghom.campaigns AS campaign ON campaign.id = lead.campaign_id
           LEFT JOIN tanaghom.ghl_contact_sync_state sync ON sync.lead_id = lead.id
          WHERE campaign.organization_id = $1
          ORDER BY lead.created_at DESC
          LIMIT 100`,
        [user.organizationId],
      );
      const performance = await client.query(
        `WITH organization_posts AS (
           SELECT post.* FROM tanaghom.posts post
           JOIN tanaghom.content_items content ON content.id = post.content_item_id
           JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
           WHERE campaign.organization_id = $1
         ), latest AS (
           SELECT DISTINCT ON (observation.post_id, observation.metric_key)
             observation.post_id, observation.metric_key, observation.metric_value
           FROM tanaghom.post_metric_observations observation
           WHERE observation.organization_id = $1
           ORDER BY observation.post_id, observation.metric_key,
             observation.observed_on DESC, observation.synced_at DESC
         )
         SELECT
           coalesce(sum(metric_value) FILTER (WHERE metric_key = 'impressions'), 0)::numeric AS impressions,
           coalesce(sum(metric_value) FILTER (WHERE metric_key = 'clicks'), 0)::numeric AS clicks,
           coalesce(sum(metric_value) FILTER (WHERE metric_key = 'likes'), 0)::numeric AS likes,
           coalesce(sum(metric_value) FILTER (WHERE metric_key = 'comments'), 0)::numeric AS comments,
           coalesce(sum(metric_value) FILTER (WHERE metric_key = 'shares'), 0)::numeric AS shares,
           coalesce(sum(metric_value) FILTER (WHERE metric_key = 'views'), 0)::numeric AS views,
           (SELECT coalesce(sum(spend), 0)::numeric FROM organization_posts) AS spend,
           (SELECT count(*) FILTER (WHERE status = 'live')::int FROM organization_posts) AS live_posts,
           (SELECT count(*) FILTER (WHERE status = 'failed')::int FROM organization_posts) AS failed_posts,
           (SELECT count(*)::int FROM tanaghom.post_performance_sync_state state
             WHERE state.organization_id = $1
               AND (state.last_success_at IS NULL OR state.stale_after < statement_timestamp())) AS stale_posts,
           (SELECT max(last_success_at) FROM tanaghom.post_performance_sync_state
             WHERE organization_id = $1) AS last_synced_at,
           (SELECT count(*)::int FROM tanaghom.lead_attribution_records attribution
             WHERE attribution.organization_id = $1 AND attribution.status = 'quarantined') AS quarantined_leads
         FROM latest`,
        [user.organizationId],
      );
      const campaignPerformance = await client.query(
        `WITH latest AS (
           SELECT DISTINCT ON (observation.post_id, observation.metric_key)
             observation.post_id, observation.metric_key, observation.metric_value
           FROM tanaghom.post_metric_observations observation
           WHERE observation.organization_id = $1
           ORDER BY observation.post_id, observation.metric_key,
             observation.observed_on DESC, observation.synced_at DESC
         )
         SELECT campaign.id AS campaign_id, campaign.name AS campaign_name,
                count(DISTINCT post.id)::int AS posts,
                coalesce(sum(latest.metric_value) FILTER (WHERE latest.metric_key = 'impressions'), 0)::numeric AS impressions,
                coalesce(sum(latest.metric_value) FILTER (WHERE latest.metric_key = 'clicks'), 0)::numeric AS clicks,
                coalesce(sum(latest.metric_value) FILTER (WHERE latest.metric_key = 'likes'), 0)::numeric AS likes,
                coalesce(sum(latest.metric_value) FILTER (WHERE latest.metric_key = 'comments'), 0)::numeric AS comments,
                coalesce(sum(latest.metric_value) FILTER (WHERE latest.metric_key = 'shares'), 0)::numeric AS shares,
                max(state.last_success_at) AS last_synced_at,
                count(DISTINCT state.post_id) FILTER (
                  WHERE state.last_success_at IS NULL OR state.stale_after < statement_timestamp()
                )::int AS stale_posts
           FROM tanaghom.campaigns campaign
           LEFT JOIN tanaghom.content_items content ON content.campaign_id = campaign.id
           LEFT JOIN tanaghom.posts post ON post.content_item_id = content.id
           LEFT JOIN latest ON latest.post_id = post.id
           LEFT JOIN tanaghom.post_performance_sync_state state ON state.post_id = post.id
          WHERE campaign.organization_id = $1
          GROUP BY campaign.id
          ORDER BY impressions DESC, campaign.updated_at DESC
          LIMIT 100`,
        [user.organizationId],
      );
      const postPerformance = await client.query(
        `WITH latest AS (
           SELECT DISTINCT ON (observation.post_id, observation.metric_key)
             observation.post_id, observation.metric_key, observation.metric_value
           FROM tanaghom.post_metric_observations observation
           WHERE observation.organization_id = $1
           ORDER BY observation.post_id, observation.metric_key,
             observation.observed_on DESC, observation.synced_at DESC
         ), metric_map AS (
           SELECT post_id, jsonb_object_agg(metric_key, metric_value) AS metrics
           FROM latest GROUP BY post_id
         )
         SELECT post.id, post.provider_post_id, post.channel, post.status,
                post.posted_at, post.last_synced_at, campaign.id AS campaign_id,
                campaign.name AS campaign_name, content.id AS content_item_id,
                left(content.draft_copy, 180) AS content_excerpt,
                coalesce(metric_map.metrics, '{}'::jsonb) AS metrics,
                state.status AS sync_status, state.last_success_at,
                state.last_error_code,
                (state.last_success_at IS NULL OR state.stale_after < statement_timestamp()) AS is_stale
           FROM tanaghom.posts post
           JOIN tanaghom.content_items content ON content.id = post.content_item_id
           JOIN tanaghom.campaigns campaign ON campaign.id = content.campaign_id
           LEFT JOIN metric_map ON metric_map.post_id = post.id
           LEFT JOIN tanaghom.post_performance_sync_state state ON state.post_id = post.id
          WHERE campaign.organization_id = $1
          ORDER BY coalesce(state.last_success_at, post.created_at) DESC
          LIMIT 100`,
        [user.organizationId],
      );
      const attributionQuarantine = await client.query(
        `SELECT id, provider, provider_event_id, quarantine_reason, received_at, evidence
           FROM tanaghom.lead_attribution_records
          WHERE organization_id = $1 AND status = 'quarantined'
          ORDER BY received_at DESC LIMIT 50`,
        [user.organizationId],
      );
      const notifications = await client.query(
        `SELECT id, severity, title, body, entity_type, entity_id, created_at
           FROM tanaghom.notifications
          WHERE read_at IS NULL
            AND (user_id IS NULL OR user_id IN (
              SELECT id FROM tanaghom.app_users WHERE organization_id = $1
            ))
          ORDER BY created_at DESC
          LIMIT 50`,
        [user.organizationId],
      );
      await client.query("COMMIT");

      return noStore({
        summary: summary.rows[0],
        campaigns: campaigns.rows,
        agents: agents.rows,
        leads: leads.rows,
        performance: performance.rows[0],
        campaign_performance: campaignPerformance.rows,
        post_performance: postPerformance.rows,
        attribution_quarantine: attributionQuarantine.rows,
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
