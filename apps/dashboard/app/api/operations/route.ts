import type { NextRequest } from "next/server";

import { buildAgentRegistry, type RegistryJobRow } from "@/lib/server/agent-registry";
import { ghlActionRuntimeBlockers, postizAutomationRuntimeBlockers } from "@/lib/server/automation-management";
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
                campaign.currency, campaign.content_item_target, campaign.created_at, campaign.updated_at,
                core_job.job_type AS core_job_type, core_job.status AS core_job_status,
                count(DISTINCT content.id)::int AS content_total,
                count(DISTINCT content.id) FILTER (WHERE content.status = 'pending_approval')::int AS content_pending,
                count(DISTINCT lead.id)::int AS leads_total
           FROM tanaghom.campaigns AS campaign
           LEFT JOIN tanaghom.content_items AS content ON content.campaign_id = campaign.id
           LEFT JOIN tanaghom.leads AS lead ON lead.campaign_id = campaign.id
           LEFT JOIN LATERAL (
             SELECT job.job_type,job.status
               FROM tanaghom.agent_jobs job
              WHERE job.campaign_id=campaign.id
                AND job.job_type IN ('campaign.strategy.generate','campaign.content.generate')
                AND job.status IN ('queued','running','waiting_approval')
              ORDER BY job.created_at DESC LIMIT 1
           ) core_job ON true
          WHERE campaign.organization_id = $1
          GROUP BY campaign.id,core_job.job_type,core_job.status
          ORDER BY campaign.updated_at DESC
          LIMIT 100`,
        [user.organizationId],
      );
      const agentRoles = await client.query(
        `SELECT role.code,role.name,role.short_name,role.responsibility,role.display_order,
                agent.id AS agent_record_id
           FROM tanaghom.agent_role_registry role
           LEFT JOIN tanaghom.agents agent ON agent.code=role.code
          ORDER BY role.display_order`,
      );
      const agentWorkers = await client.query(
        `SELECT code,role_code,name,responsibility,phase,workflow_name,workflow_version,
                source_path,job_types,release_state,runtime_state,trigger_state,
                runtime_verified_at,runtime_evidence,display_order
           FROM tanaghom.agent_workflow_registry
          ORDER BY display_order`,
      );
      const skillRegistry = await client.query(
        `SELECT definition.id,definition.organization_id,definition.owner_scope,
                definition.code,definition.name,definition.description,definition.skill_class,
                version.id AS version_id,version.version_number,version.lifecycle_state,
                version.instructions,version.input_schema_ref,version.output_schema_ref,
                version.risk_class,version.side_effect_class,version.permission_manifest,
                version.integration_requirements,version.executor_type,version.executor_ref,
                version.executor_version,version.package_path,version.content_hash,
                version.tool_schema_hash,version.published_at,version.deprecated_at,
                coalesce((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id',binding.id,
                    'organization_id',binding.organization_id,
                    'role_code',binding.role_code,
                    'worker_code',binding.worker_code,
                    'binding_state',binding.binding_state
                  ) ORDER BY binding.worker_code)
                    FROM tanaghom.agent_skill_bindings binding
                   WHERE binding.skill_version_id=version.id
                     AND (binding.organization_id IS NULL OR binding.organization_id=$1)
                ),'[]'::jsonb) AS bindings
           FROM tanaghom.skill_definitions definition
           JOIN tanaghom.skill_versions version ON version.skill_id=definition.id
          WHERE (definition.organization_id IS NULL OR definition.organization_id=$1)
            AND version.lifecycle_state IN ('published','deprecated')
          ORDER BY definition.owner_scope,definition.code,version.version_number DESC`,
        [user.organizationId],
      );
      const agentJobs = await client.query(
        `WITH scoped AS (
           SELECT job.id,role.code AS role_code,worker.code AS worker_code,job.job_type,job.status,
                  job.campaign_id,campaign.name AS campaign_name,job.attempt,job.max_attempts,
                  job.created_at,job.started_at,job.updated_at,job.finished_at,
                  job.error_code,job.error_message,
                  (SELECT count(*)::int FROM tanaghom.content_items content
                    WHERE content.campaign_id=job.campaign_id AND content.status='pending_approval') AS pending_approvals,
                  row_number() OVER (
                    PARTITION BY role.code
                    ORDER BY (job.status IN ('queued','running','waiting_approval')) DESC,job.created_at DESC
                  ) AS role_rank
             FROM tanaghom.agent_jobs job
             JOIN tanaghom.agents agent ON agent.id=job.agent_id
             JOIN tanaghom.agent_role_registry role ON role.code=agent.code
             LEFT JOIN tanaghom.agent_workflow_registry worker ON job.job_type=ANY(worker.job_types)
             LEFT JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
            WHERE campaign.organization_id=$1
               OR (job.campaign_id IS NULL AND job.input->>'organization_id'=$1::text)
         )
         SELECT id,role_code,worker_code,job_type,status,campaign_id,campaign_name,
                attempt,max_attempts,created_at,started_at,updated_at,finished_at,error_code,error_message,
                pending_approvals,
                (job_type='campaign.content.generate' AND status='waiting_approval'
                  AND pending_approvals=0) AS requires_reconciliation
           FROM scoped WHERE role_rank<=5
          ORDER BY role_code,(status IN ('queued','running','waiting_approval')) DESC,created_at DESC`,
        [user.organizationId],
      );
      const qualityJobs = await client.query(
        `SELECT job.id,'sales_crm'::text AS role_code,'quality_shadow_evaluator'::text AS worker_code,
                'quality.shadow.evaluate'::text AS job_type,job.status,NULL::uuid AS campaign_id,
                dataset.source_label AS campaign_name,job.attempt_count AS attempt,3 AS max_attempts,
                job.queued_at AS created_at,job.claimed_at AS started_at,
                coalesce(job.completed_at,job.claimed_at,job.queued_at) AS updated_at,
                job.completed_at AS finished_at,job.error_code,job.error_message,
                0 AS pending_approvals,false AS requires_reconciliation
           FROM tanaghom.quality_shadow_jobs job
           JOIN tanaghom.quality_evaluation_datasets dataset ON dataset.id=job.dataset_id
          WHERE job.organization_id=$1
          ORDER BY (job.status IN ('queued','running')) DESC,job.queued_at DESC LIMIT 5`,
        [user.organizationId],
      );
      const ghlActionJobs = await client.query(
        `SELECT job.id,'sales_crm'::text AS role_code,'governed_ghl_actions'::text AS worker_code,
                ('ghl.action.'||job.action_type)::text AS job_type,
                CASE job.status WHEN 'claimed' THEN 'running' WHEN 'dispatching' THEN 'running'
                  WHEN 'awaiting_approval' THEN 'waiting_approval' WHEN 'canceled' THEN 'cancelled'
                  ELSE job.status END AS status,
                NULL::uuid AS campaign_id,
                concat_ws(' · ',initcap(job.action_type),job.channel,job.contact_id) AS campaign_name,
                job.attempt,job.max_attempts,job.created_at,job.claimed_at AS started_at,
                job.updated_at,job.finished_at,job.error_code,job.error_message,
                0 AS pending_approvals,false AS requires_reconciliation
           FROM tanaghom.ghl_action_jobs job
          WHERE job.organization_id=$1
          ORDER BY (job.status IN ('queued','claimed','dispatching','awaiting_approval','indeterminate')) DESC,
                   job.created_at DESC LIMIT 5`,
        [user.organizationId],
      );
      const postizReadiness = await client.query(
        `SELECT postiz_draft_mode,emergency_stop,emergency_stop_reason,
                connection_ready,channel_mapping_ready,operations_clear
           FROM tanaghom.postiz_automation_status WHERE organization_id=$1`,
        [user.organizationId],
      );
      const ghlReadiness = await client.query(
        `SELECT action_mode,proactive_message_mode,platform_emergency_stop,
                action_emergency_stop,action_emergency_reason,connection_ready,
                operations_clear,action_allowed_channels
           FROM tanaghom.ghl_action_automation_status WHERE organization_id=$1`,
        [user.organizationId],
      );
      const qualityReadiness = await client.query(
        `SELECT policy.current_stage,policy.minimum_sample_size,
                count(DISTINCT dataset.id)::int AS dataset_count,
                count(DISTINCT dataset.id) FILTER (WHERE dataset.baseline_snapshot_id IS NOT NULL)::int AS baseline_recorded_count,
                count(DISTINCT shadow.id)::int AS shadow_job_count
           FROM tanaghom.quality_rollout_policies policy
           LEFT JOIN tanaghom.quality_evaluation_datasets dataset ON dataset.organization_id=policy.organization_id
           LEFT JOIN tanaghom.quality_shadow_jobs shadow ON shadow.dataset_id=dataset.id
          WHERE policy.organization_id=$1
          GROUP BY policy.organization_id,policy.current_stage,policy.minimum_sample_size`,
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
      const postiz = postizReadiness.rows[0] || {
        postiz_draft_mode: "manual", emergency_stop: true,
        emergency_stop_reason: "Postiz policy is unavailable", connection_ready: false,
        channel_mapping_ready: false, operations_clear: false,
      };
      const ghl = ghlReadiness.rows[0] || {
        action_mode: "manual", proactive_message_mode: "disabled",
        platform_emergency_stop: true, action_emergency_stop: true,
        action_emergency_reason: "GHL policy is unavailable", connection_ready: false,
        operations_clear: false, action_allowed_channels: [],
      };
      const quality = qualityReadiness.rows[0] || {
        current_stage: "baseline", minimum_sample_size: 25,
        dataset_count: 0, baseline_recorded_count: 0, shadow_job_count: 0,
      };
      const registryJobs = (
        [...agentJobs.rows, ...qualityJobs.rows, ...ghlActionJobs.rows]
      ) as Array<RegistryJobRow & { role_code: string }>;
      const agentRegistry = buildAgentRegistry({
        roles: agentRoles.rows,
        workers: agentWorkers.rows,
        jobs: registryJobs,
        readiness: {
          postiz: {
            mode: postiz.postiz_draft_mode,
            emergency_stop: postiz.emergency_stop,
            emergency_stop_reason: postiz.emergency_stop_reason,
            connection_ready: postiz.connection_ready,
            channel_mapping_ready: postiz.channel_mapping_ready,
            operations_clear: postiz.operations_clear,
            runtime_blockers: postizAutomationRuntimeBlockers(),
          },
          ghl: {
            mode: ghl.action_mode,
            proactive_message_mode: ghl.proactive_message_mode,
            platform_emergency_stop: ghl.platform_emergency_stop,
            organization_emergency_stop: ghl.action_emergency_stop,
            organization_emergency_reason: ghl.action_emergency_reason,
            connection_ready: ghl.connection_ready,
            operations_clear: ghl.operations_clear,
            allowed_channels: ghl.action_allowed_channels,
            runtime_blockers: ghlActionRuntimeBlockers(),
          },
          quality: {
            current_stage: quality.current_stage,
            minimum_sample_size: quality.minimum_sample_size,
            dataset_count: quality.dataset_count,
            baseline_recorded_count: quality.baseline_recorded_count,
            shadow_job_count: quality.shadow_job_count,
          },
        },
      });
      await client.query("COMMIT");

      return noStore({
        current_user: user,
        summary: summary.rows[0],
        campaigns: campaigns.rows,
        agents: agentRegistry.roles.map((role) => ({
          id: role.agent_record_id || role.code,
          code: role.code,
          name: role.name,
          description: role.responsibility,
          status: role.operational_state,
          last_heartbeat_at: role.current_job?.updated_at || null,
          current_job_id: role.current_job?.id || null,
          current_job_type: role.current_job?.job_type || null,
          current_job_status: role.current_job?.status || null,
          campaign_id: role.current_job?.campaign_id || null,
          current_job_started_at: role.current_job?.started_at || null,
        })),
        agent_registry: agentRegistry,
        skill_registry: {
          contract_version: "tanaghom.skill-registry.v1",
          generated_at: new Date().toISOString(),
          summary: {
            total: skillRegistry.rows.length,
            platform: skillRegistry.rows.filter((skill) => skill.owner_scope === "platform").length,
            organization: skillRegistry.rows.filter((skill) => skill.owner_scope === "organization").length,
            published: skillRegistry.rows.filter((skill) => skill.lifecycle_state === "published").length,
          },
          skills: skillRegistry.rows,
        },
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
