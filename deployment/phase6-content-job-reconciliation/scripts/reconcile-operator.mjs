#!/usr/bin/env node
import pg from "pg";

const [action, campaignName, jobId] = process.argv.slice(2);
const allowed = ["snapshot", "preflight", "reconcile", "verify-complete"];
const expectedMigration = process.env.TANAGHOM_EXPECTED_MIGRATION || "0023_campaign_lifecycle";
if (!["0023_campaign_lifecycle", "0024_conversation_intelligence_worker_registry", "0025_runtime_agent_reconciliation"].includes(expectedMigration)) {
  throw new Error("TANAGHOM_EXPECTED_MIGRATION is not an approved reconciliation baseline");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!allowed.includes(action) || !campaignName?.endsWith(".test")) {
  throw new Error(`usage: reconcile-operator.mjs ${allowed.join("|")} NAME.test JOB_UUID`);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(jobId || "")) {
  throw new Error("JOB_UUID must be a lowercase RFC 4122 UUID");
}

const connectionUrl = new URL(process.env.DATABASE_URL);
if (process.env.TANAGHOM_DATABASE_SSL_MODE) {
  if (process.env.TANAGHOM_DATABASE_SSL_MODE !== "verify-full") {
    throw new Error("TANAGHOM_DATABASE_SSL_MODE must be verify-full");
  }
  connectionUrl.searchParams.set("sslmode", "verify-full");
}
const client = new pg.Client({
  connectionString: connectionUrl.toString(),
  application_name: "tanaghom-content-job-reconciliation",
});
await client.connect();

async function lockTargetContext() {
  const target = await client.query(`
    SELECT job.id
      FROM tanaghom.agent_jobs job
      JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
      JOIN tanaghom.agents agent ON agent.id=job.agent_id
     WHERE job.id=$1 AND campaign.name=$2
     FOR UPDATE OF job,campaign,agent`, [jobId, campaignName]);
  if (target.rowCount !== 1) throw new Error("exact reconciliation job and campaign were not found");

  await client.query(`
    SELECT related.id
      FROM tanaghom.agent_jobs target
      JOIN tanaghom.agent_jobs related ON related.campaign_id=target.campaign_id
     WHERE target.id=$1
     FOR SHARE OF related`, [jobId]);
  await client.query(`
    SELECT content.id
      FROM tanaghom.outbox_events event
      CROSS JOIN LATERAL jsonb_array_elements_text(event.payload->'content_item_ids') generated(id)
      JOIN tanaghom.content_items content ON content.id=generated.id::uuid
     WHERE event.event_key='content.generated:'||$1::text
     FOR SHARE OF content`, [jobId]);
  await client.query(`
    SELECT approval.id
      FROM tanaghom.outbox_events event
      CROSS JOIN LATERAL jsonb_array_elements_text(event.payload->'content_item_ids') generated(id)
      JOIN tanaghom.content_approvals approval ON approval.content_item_id=generated.id::uuid
      JOIN tanaghom.app_users reviewer ON reviewer.id=approval.decided_by
     WHERE event.event_key='content.generated:'||$1::text
     FOR SHARE OF approval,reviewer`, [jobId]);
}

async function snapshot() {
  const migration = (await client.query(
    "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
  )).rows[0]?.version;
  const targetResult = await client.query(`
    SELECT job.id,job.status,job.job_type,job.correlation_id,job.finished_at,
           campaign.id AS campaign_id,campaign.name AS campaign_name,
           campaign.status AS campaign_status,campaign.organization_id,
           campaign.budget_target,campaign.revenue_target,
           agent.id AS agent_id,agent.code AS agent_code,agent.status AS agent_status
      FROM tanaghom.agent_jobs job
      JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
      JOIN tanaghom.agents agent ON agent.id=job.agent_id
     WHERE job.id=$1 AND campaign.name=$2`, [jobId, campaignName]);
  if (targetResult.rowCount !== 1) throw new Error("exact reconciliation job and campaign were not found");
  const target = targetResult.rows[0];

  const generated = (await client.query(`
    WITH generated AS (
      SELECT DISTINCT generated.id::uuid AS content_id
        FROM tanaghom.outbox_events event
        CROSS JOIN LATERAL jsonb_array_elements_text(event.payload->'content_item_ids') generated(id)
       WHERE event.event_key='content.generated:'||$1::text
    )
    SELECT generated.content_id,content.status,
           (SELECT count(*)::int
              FROM tanaghom.content_approvals approval
              JOIN tanaghom.app_users reviewer ON reviewer.id=approval.decided_by
             WHERE approval.content_item_id=generated.content_id
               AND approval.decision=content.status
               AND reviewer.organization_id=$2
               AND reviewer.kind='human'
               AND reviewer.role IN ('owner','reviewer')
               AND reviewer.is_active
               AND reviewer.accepted_at IS NOT NULL) AS matching_active_human_decisions
      FROM generated
      LEFT JOIN tanaghom.content_items content ON content.id=generated.content_id
     ORDER BY generated.content_id`, [jobId, target.organization_id])).rows;

  const metrics = (await client.query(`
    SELECT
      (SELECT count(*)::int FROM tanaghom.campaign_strategies strategy WHERE strategy.campaign_id=$1) AS strategies,
      (SELECT count(*)::int FROM tanaghom.content_items content WHERE content.campaign_id=$1) AS campaign_content,
      (SELECT count(*)::int FROM tanaghom.agent_jobs job WHERE job.campaign_id=$1) AS core_job_count,
      (SELECT count(*)::int FROM tanaghom.agent_jobs job WHERE job.campaign_id=$1 AND job.job_type='campaign.strategy.generate' AND job.status='succeeded') AS successful_strategist_jobs,
      (SELECT count(*)::int FROM tanaghom.agent_jobs job WHERE job.campaign_id=$1 AND job.id=$2 AND job.job_type='campaign.content.generate') AS target_content_jobs,
      (SELECT count(*)::int FROM tanaghom.agent_jobs job WHERE job.campaign_id=$1 AND job.job_type NOT IN ('campaign.strategy.generate','campaign.content.generate')) AS forbidden_jobs,
      (SELECT count(*)::int FROM tanaghom.posts post JOIN tanaghom.content_items content ON content.id=post.content_item_id WHERE content.campaign_id=$1) AS posts,
      (SELECT count(*)::int FROM tanaghom.leads lead WHERE lead.campaign_id=$1) AS leads,
      (SELECT count(*)::int FROM tanaghom.external_operations operation WHERE operation.correlation_id IN (SELECT job.correlation_id FROM tanaghom.agent_jobs job WHERE job.campaign_id=$1)) AS external_operations,
      (SELECT count(*)::int FROM tanaghom.agent_actions_log action WHERE action.job_id=$2 AND action.action_type='content.review_completed' AND action.result='success') AS completion_audits,
      (SELECT count(*)::int FROM tanaghom.agent_jobs job WHERE job.status='running') AS globally_running_jobs,
      (SELECT count(*)::int FROM tanaghom.agent_workflow_registry registry WHERE registry.code IN ('campaign_strategy_generator','campaign_content_generator') AND registry.runtime_state='imported_inactive' AND registry.trigger_state='workflow_inactive_only') AS inactive_registry_entries,
      (SELECT count(*)::int FROM tanaghom.automation_platform_controls control WHERE control.emergency_stop IS NOT TRUE) AS open_provider_stops,
      (SELECT count(*)::int FROM tanaghom.organization_automation_policies policy WHERE policy.postiz_draft_mode<>'manual') AS nonmanual_postiz_policies,
      (SELECT count(*)::int FROM tanaghom.organization_crm_policies policy WHERE policy.contact_sync_mode<>'manual' OR policy.conversation_processing_mode<>'paused' OR policy.conversation_emergency_stop IS NOT TRUE OR policy.action_mode<>'manual' OR policy.proactive_message_mode<>'disabled' OR policy.action_emergency_stop IS NOT TRUE) AS open_crm_policies`,
    [target.campaign_id, jobId])).rows[0];

  const privileges = (await client.query(`
    SELECT
      current_user AS operator_current_user,
      session_user AS operator_session_user,
      role.rolsuper AS operator_superuser,
      role.rolcreaterole AS operator_can_create_role,
      membership.admin_option AS operator_worker_admin_option,
      membership.inherit_option AS operator_worker_inherit_option,
      membership.set_option AS operator_worker_set_option,
      grantor.rolname AS operator_worker_grantor,
      (SELECT count(*)::int
         FROM pg_auth_members candidate
         JOIN pg_roles candidate_member ON candidate_member.oid=candidate.member
         JOIN pg_roles candidate_granted ON candidate_granted.oid=candidate.roleid
        WHERE candidate_member.rolname=session_user
          AND candidate_granted.rolname='tanaghom_n8n_worker') AS operator_worker_membership_rows,
      has_function_privilege('tanaghom_n8n_worker','tanaghom.complete_content_job(uuid)','EXECUTE') AS worker_can_complete,
      has_table_privilege('tanaghom_n8n_worker','tanaghom.content_approvals','SELECT,INSERT,UPDATE,DELETE') AS worker_has_approval_table_access,
      has_table_privilege('tanaghom_n8n_worker','tanaghom.agent_jobs','INSERT,UPDATE,DELETE') AS worker_has_job_table_write
    FROM pg_roles role
    JOIN pg_auth_members membership ON membership.member=role.oid
    JOIN pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_roles grantor ON grantor.oid=membership.grantor
    WHERE role.rolname=session_user
      AND granted.rolname='tanaghom_n8n_worker'`)).rows[0];
  if (!privileges) throw new Error("operator-to-worker membership evidence is missing");

  return {
    migration,
    job: {
      id: target.id,
      type: target.job_type,
      status: target.status,
      correlation_id: target.correlation_id,
      finished_at: target.finished_at,
    },
    campaign: {
      id: target.campaign_id,
      name: target.campaign_name,
      status: target.campaign_status,
      organization_id: target.organization_id,
      budget_target: target.budget_target,
      revenue_target: target.revenue_target,
    },
    agent: { id: target.agent_id, code: target.agent_code, status: target.agent_status },
    generated: generated.map((item) => ({
      id: item.content_id,
      status: item.status,
      matching_active_human_decisions: item.matching_active_human_decisions,
    })),
    metrics,
    privileges,
  };
}

function assertCommon(state) {
  if (state.migration !== expectedMigration) throw new Error(`database is not at migration ${expectedMigration}`);
  if (state.job.type !== "campaign.content.generate") throw new Error("target is not a content-generation job");
  if (state.agent.code !== "content_producer") throw new Error("target job does not belong to Content Producer");
  if (Number(state.campaign.budget_target) !== 0 || Number(state.campaign.revenue_target) !== 0) throw new Error("canary budget or revenue target is non-zero");
  if (state.campaign.status !== "awaiting_approval") throw new Error("canary campaign is not at the approval boundary");
  if (state.generated.length < 1 || state.generated.length > 2) throw new Error("generated content count is outside the canary boundary");
  if (state.metrics.campaign_content !== state.generated.length) throw new Error("campaign content differs from generated content evidence");
  for (const item of state.generated) {
    if (!["approved", "rejected"].includes(item.status)) throw new Error("generated content still lacks a final human decision");
    if (item.matching_active_human_decisions !== 1) throw new Error("generated content lacks exactly one active same-organization human decision");
  }
  if (state.metrics.strategies !== 1 || state.metrics.core_job_count !== 2 || state.metrics.successful_strategist_jobs !== 1 || state.metrics.target_content_jobs !== 1) throw new Error("canary strategy or core-job evidence is not exact");
  if (state.metrics.forbidden_jobs || state.metrics.posts || state.metrics.leads || state.metrics.external_operations) throw new Error("canary has a forbidden side effect or unrelated job");
  if (state.metrics.globally_running_jobs) throw new Error("an agent job is already running");
  if (state.metrics.inactive_registry_entries !== 2) throw new Error("core workflow registry is not restored inactive");
  if (state.metrics.open_provider_stops || state.metrics.nonmanual_postiz_policies || state.metrics.open_crm_policies) throw new Error("automation safety locks are not closed");
  if (state.privileges.operator_current_user !== state.privileges.operator_session_user) throw new Error("operator session began under an assumed role");
  if (state.privileges.operator_superuser || !state.privileges.operator_can_create_role) throw new Error("operator role capability shape is invalid");
  if (state.privileges.operator_worker_membership_rows !== 1 || state.privileges.operator_worker_grantor === state.privileges.operator_session_user) throw new Error("operator worker membership grantor shape is invalid");
  if (!state.privileges.operator_worker_admin_option || state.privileges.operator_worker_inherit_option || state.privileges.operator_worker_set_option) throw new Error("operator worker membership is not ADMIN TRUE, INHERIT FALSE, SET FALSE");
  if (!state.privileges.worker_can_complete || state.privileges.worker_has_approval_table_access || state.privileges.worker_has_job_table_write) throw new Error("n8n worker privilege boundary is invalid");
}

function assertWaiting(state) {
  assertCommon(state);
  if (state.job.status !== "waiting_approval" || state.job.finished_at) throw new Error("target job is not waiting for reconciliation");
  if (state.agent.status !== "waiting_approval") throw new Error("Content Producer is not waiting for approval");
  if (state.metrics.completion_audits !== 0) throw new Error("completion audit already exists");
}

function assertCompleted(state) {
  assertCommon(state);
  if (state.job.status !== "succeeded" || !state.job.finished_at) throw new Error("target job is not durably succeeded");
  if (state.agent.status !== "idle") throw new Error("Content Producer did not return idle");
  if (state.metrics.completion_audits !== 1) throw new Error("completion audit count is not exactly one");
}

async function readOnly(expected) {
  await client.query("BEGIN READ ONLY");
  try {
    const state = await snapshot();
    if (expected === "waiting") assertWaiting(state);
    if (expected === "completed") assertCompleted(state);
    await client.query("ROLLBACK");
    console.log(JSON.stringify(state));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function reconcile() {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await lockTargetContext();
    const before = await snapshot();
    assertWaiting(before);
    const disableInherit = (await client.query(
      "SELECT format('GRANT tanaghom_n8n_worker TO %I WITH INHERIT FALSE GRANTED BY CURRENT_USER',session_user) AS sql",
    )).rows[0].sql;
    await client.query(disableInherit);
    const enableSet = (await client.query(
      "SELECT format('GRANT tanaghom_n8n_worker TO %I WITH SET TRUE GRANTED BY CURRENT_USER',session_user) AS sql",
    )).rows[0].sql;
    await client.query(enableSet);
    const enabled = (await client.query(`
      SELECT count(*)::int AS membership_rows,
             count(*) FILTER (WHERE grantor.rolname=session_user AND NOT membership.admin_option AND NOT membership.inherit_option AND membership.set_option)::int AS temporary_set_rows,
             count(*) FILTER (WHERE grantor.rolname<>session_user AND membership.admin_option AND NOT membership.inherit_option AND NOT membership.set_option)::int AS original_rows
      FROM pg_auth_members membership
      JOIN pg_roles member ON member.oid=membership.member
      JOIN pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_roles grantor ON grantor.oid=membership.grantor
      WHERE member.rolname=session_user AND granted.rolname='tanaghom_n8n_worker'`)).rows[0];
    if (enabled?.membership_rows !== 2 || enabled.temporary_set_rows !== 1 || enabled.original_rows !== 1) {
      throw new Error("transactional worker SET option was not enabled exactly");
    }
    await client.query("SET LOCAL ROLE tanaghom_n8n_worker");
    const role = (await client.query("SELECT current_user,session_user")).rows[0];
    if (role.current_user !== "tanaghom_n8n_worker" || role.session_user === role.current_user) {
      throw new Error("reconciliation did not enter the restricted worker role");
    }
    const completion = (await client.query(
      "SELECT tanaghom.complete_content_job($1::uuid) AS completed",
      [jobId],
    )).rows[0];
    if (completion.completed !== true) throw new Error("controlled completion function did not return true");
    await client.query("RESET ROLE");
    const revokeTemporarySet = (await client.query(
      "SELECT format('REVOKE tanaghom_n8n_worker FROM %I GRANTED BY CURRENT_USER',session_user) AS sql",
    )).rows[0].sql;
    await client.query(revokeTemporarySet);
    const after = await snapshot();
    assertCompleted(after);
    await client.query("COMMIT");
    console.log(JSON.stringify({
      completed: true,
      execution_role: role.current_user,
      session_role: role.session_user,
      before,
      after,
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

try {
  if (action === "snapshot") await readOnly(null);
  else if (action === "preflight") await readOnly("waiting");
  else if (action === "verify-complete") await readOnly("completed");
  else await reconcile();
} finally {
  await client.end();
}
