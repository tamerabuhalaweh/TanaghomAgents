#!/usr/bin/env node
import pg from "pg";

const [action, campaignId, strategyJobId, campaignName, expectedItemsRaw, contentJobId] = process.argv.slice(2);
const allowed = ["check-database", "verify-authorized", "verify-strategy", "verify-resume-authorized", "queue-content", "verify-content-ready", "verify-pending", "verify-approved"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const expectedItems = Number(expectedItemsRaw);
const expectedMigration = process.env.TANAGHOM_EXPECTED_MIGRATION || "0023_campaign_lifecycle";
if (!["0023_campaign_lifecycle", "0024_conversation_intelligence_worker_registry", "0025_runtime_agent_reconciliation"].includes(expectedMigration)) throw new Error("TANAGHOM_EXPECTED_MIGRATION is not an approved canary baseline");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!allowed.includes(action) || !uuid.test(campaignId) || !uuid.test(strategyJobId) || !campaignName?.endsWith(".test") || !Number.isInteger(expectedItems) || expectedItems < 1 || expectedItems > 12) {
  throw new Error(`usage: existing-campaign-operator.mjs ${allowed.join("|")} CAMPAIGN_UUID STRATEGY_JOB_UUID NAME.test EXPECTED_ITEMS [CONTENT_JOB_UUID]`);
}
if (["verify-content-ready", "verify-pending", "verify-approved"].includes(action) && !uuid.test(contentJobId ?? "")) throw new Error("content job UUID is required");

const connectionUrl = new URL(process.env.DATABASE_URL);
if (process.env.TANAGHOM_DATABASE_SSL_MODE) {
  if (process.env.TANAGHOM_DATABASE_SSL_MODE !== "verify-full") throw new Error("TANAGHOM_DATABASE_SSL_MODE must be verify-full");
  connectionUrl.searchParams.set("sslmode", "verify-full");
}
const client = new pg.Client({ connectionString: connectionUrl.toString(), application_name: "tanaghom-existing-campaign-canary" });
await client.connect();

async function checkDatabase() {
  await client.query("BEGIN READ ONLY");
  try {
    const migration = (await client.query("SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1")).rows[0]?.version;
    if (migration !== expectedMigration) throw new Error("unexpected database migration during Node TLS check");
    await client.query("ROLLBACK");
    return { database_tls: "verified", transaction: "read_only", migration };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function authorizedSnapshot() {
  const result = await client.query(`SELECT
      c.id,c.name,c.status,c.content_item_target,c.budget_target,c.revenue_target,c.currency,c.organization_id,c.created_by,
      u.kind actor_kind,u.role actor_role,u.is_active actor_active,u.accepted_at actor_accepted_at,o.is_active organization_active,
      j.id strategy_job_id,j.status strategy_job_status,j.attempt strategy_attempt,j.max_attempts strategy_max_attempts,j.input strategy_input,
      (SELECT count(*)::int FROM tanaghom.agent_jobs q WHERE q.job_type IN ('campaign.strategy.generate','campaign.content.generate') AND q.status='queued' AND q.available_at<=now() AND q.attempt<q.max_attempts) claimable_core_jobs,
      (SELECT count(*)::int FROM tanaghom.agent_jobs q WHERE q.job_type IN ('campaign.strategy.generate','campaign.content.generate') AND q.status='queued' AND q.available_at<=now() AND q.attempt<q.max_attempts AND q.id=j.id) exact_claimable_jobs,
      (SELECT count(*)::int FROM tanaghom.agent_jobs q WHERE q.status='running') running_jobs,
      (SELECT count(*)::int FROM tanaghom.campaign_strategies s WHERE s.campaign_id=c.id) strategies,
      (SELECT count(*)::int FROM tanaghom.agent_jobs q WHERE q.campaign_id=c.id AND q.job_type='campaign.content.generate') content_jobs,
      (SELECT count(*)::int FROM tanaghom.content_items i WHERE i.campaign_id=c.id) content_items,
      (SELECT count(*)::int FROM tanaghom.content_approvals a JOIN tanaghom.content_items i ON i.id=a.content_item_id WHERE i.campaign_id=c.id) approvals,
      (SELECT count(*)::int FROM tanaghom.external_operations x WHERE x.correlation_id IN (SELECT q.correlation_id FROM tanaghom.agent_jobs q WHERE q.campaign_id=c.id)) external_operations,
      (SELECT count(*)::int FROM tanaghom.agent_actions_log l WHERE l.entity_id=c.id AND l.action_type='campaign.created' AND l.result='success') created_audits,
      (SELECT count(*)::int FROM tanaghom.agent_actions_log l WHERE l.entity_id=c.id AND l.action_type='campaign.brief_revised' AND l.result='success') revised_audits,
      (SELECT count(*)::int FROM tanaghom.agent_actions_log l WHERE l.entity_id=c.id AND l.action_type='campaign.strategy_requested' AND l.job_id=j.id AND l.result='success') strategy_requested_audits
    FROM tanaghom.campaigns c
    JOIN tanaghom.app_users u ON u.id=c.created_by
    JOIN tanaghom.organizations o ON o.id=c.organization_id
    JOIN tanaghom.agent_jobs j ON j.id=$2 AND j.campaign_id=c.id AND j.job_type='campaign.strategy.generate'
    WHERE c.id=$1 AND c.name=$3`, [campaignId, strategyJobId, campaignName]);
  if (result.rowCount !== 1) throw new Error("exact campaign and strategy job identity did not match");
  return result.rows[0];
}

function verifyAuthorizedRow(row) {
  if (row.status !== "draft" || Number(row.budget_target) !== 0 || Number(row.revenue_target) !== 0 || row.content_item_target !== expectedItems) throw new Error("campaign is outside the authorized zero-budget draft boundary");
  if (row.actor_kind !== "human" || !["owner", "operator"].includes(row.actor_role) || !row.actor_active || !row.actor_accepted_at || !row.organization_active) throw new Error("campaign creator is not an accepted active human operator");
  if (row.strategy_job_status !== "queued" || row.strategy_attempt !== 0 || row.strategy_max_attempts !== 3) throw new Error("strategy job lifecycle differs from the authorized baseline");
  const input = row.strategy_input ?? {};
  if (input.contract_version !== "phase3.strategist-job.v1" || input.job_id !== strategyJobId || input.campaign?.id !== campaignId || input.campaign?.name !== campaignName) throw new Error("strategy job input identity differs from the authorized contract");
  if (row.claimable_core_jobs !== 1 || row.exact_claimable_jobs !== 1 || row.running_jobs !== 0) throw new Error("the exact strategy job is not the only claimable core work");
  if (row.strategies || row.content_jobs || row.content_items || row.approvals || row.external_operations) throw new Error("campaign already has downstream or external state");
  if (row.created_audits !== 1 || row.revised_audits !== 1 || row.strategy_requested_audits !== 1) throw new Error("campaign audit baseline differs from the reviewed UAT evidence");
}

async function verifyAuthorized() {
  await client.query("BEGIN READ ONLY");
  try {
    const row = await authorizedSnapshot();
    verifyAuthorizedRow(row);
    await client.query("ROLLBACK");
    return row;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function verifyStrategy() {
  const result = await client.query(`SELECT c.status,
      (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.id=$2 AND j.campaign_id=c.id AND j.job_type='campaign.strategy.generate' AND j.status='succeeded' AND j.attempt=1) successful_job,
      (SELECT count(*)::int FROM tanaghom.campaign_strategies s WHERE s.campaign_id=c.id) strategies,
      (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.campaign_id=c.id AND j.job_type='campaign.content.generate') content_jobs,
      (SELECT count(*)::int FROM tanaghom.content_items i WHERE i.campaign_id=c.id) content_items,
      (SELECT count(*)::int FROM tanaghom.external_operations x WHERE x.correlation_id IN (SELECT j.correlation_id FROM tanaghom.agent_jobs j WHERE j.campaign_id=c.id)) external_operations
    FROM tanaghom.campaigns c WHERE c.id=$1 AND c.name=$3`, [campaignId, strategyJobId, campaignName]);
  const row = result.rows[0];
  if (!row || row.status !== "strategy_ready" || row.successful_job !== 1 || row.strategies !== 1 || row.content_jobs || row.content_items || row.external_operations) throw new Error("strategist did not persist the exact authorized result cleanly");
  return row;
}

async function verifyResumeAuthorized() {
  await client.query("BEGIN READ ONLY");
  try {
    const strategy = await verifyStrategy();
    const result = await client.query(`SELECT
        (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.job_type IN ('campaign.strategy.generate','campaign.content.generate') AND j.status='queued' AND j.available_at<=now() AND j.attempt<j.max_attempts) claimable_core_jobs,
        (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.status='running') running_jobs,
        (SELECT count(*)::int FROM tanaghom.agent_actions_log l WHERE l.job_id=$2::uuid AND l.action_type='strategy.persisted' AND l.payload->>'campaign_id'=($1::uuid)::text AND l.result='success') strategy_persisted_audits,
        (SELECT count(*)::int FROM tanaghom.app_users u JOIN tanaghom.campaigns c ON c.created_by=u.id WHERE c.id=$1::uuid AND c.name=$3::text AND u.kind='human' AND u.role IN ('owner','operator') AND u.is_active AND u.accepted_at IS NOT NULL) active_campaign_operators`,
      [campaignId, strategyJobId, campaignName]);
    const row = { ...strategy, ...result.rows[0] };
    if (row.claimable_core_jobs !== 0 || row.running_jobs !== 0 || row.strategy_persisted_audits !== 1 || row.active_campaign_operators !== 1) throw new Error("persisted strategy is not at the exact safe resume boundary");
    await client.query("ROLLBACK");
    return row;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function queueContent() {
  await client.query("BEGIN");
  try {
    const before = await verifyStrategy();
    if (before.successful_job !== 1) throw new Error("strategy baseline changed before content queueing");
    const actorId = (await authorizedSnapshot()).created_by;
    const boundary = (await client.query(`SELECT
        current_user = session_user AS single_identity,
        procedure.prosecdef,
        procedure.proowner = role.oid AS connection_owns_function,
        has_function_privilege('tanaghom_api','tanaghom.queue_campaign_content(uuid,uuid)','EXECUTE') AS api_may_execute,
        has_function_privilege('tanaghom_n8n_worker','tanaghom.queue_campaign_content(uuid,uuid)','EXECUTE') AS n8n_may_execute,
        has_function_privilege('tanaghom_readonly','tanaghom.queue_campaign_content(uuid,uuid)','EXECUTE') AS readonly_may_execute,
        EXISTS (
          SELECT 1 FROM aclexplode(coalesce(procedure.proacl,acldefault('f',procedure.proowner))) acl
          WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
        ) AS public_may_execute
      FROM pg_proc procedure
      JOIN pg_roles role ON role.rolname=current_user
      WHERE procedure.oid='tanaghom.queue_campaign_content(uuid,uuid)'::regprocedure`)).rows[0];
    if (!boundary?.single_identity || !boundary.prosecdef || !boundary.connection_owns_function || !boundary.api_may_execute || boundary.n8n_may_execute || boundary.readonly_may_execute || boundary.public_may_execute) {
      throw new Error("privileged governed-function invocation boundary is not the reviewed production shape");
    }
    const queued = await client.query("SELECT * FROM tanaghom.queue_campaign_content($1::uuid,$2::uuid)", [campaignId, actorId]);
    if (queued.rowCount !== 1 || queued.rows[0].job_status !== "queued") throw new Error("governed content queue did not return one queued job");
    const job = (await client.query(`SELECT id,status,attempt,max_attempts,input FROM tanaghom.agent_jobs
      WHERE id=$1 AND campaign_id=$2 AND job_type='campaign.content.generate'`, [queued.rows[0].job_id, campaignId])).rows[0];
    if (!job || job.status !== "queued" || job.attempt !== 0 || job.max_attempts !== 3 || job.input?.contract_version !== "phase3.content-producer-job.v1" || job.input?.job_id !== job.id || job.input?.campaign?.id !== campaignId || job.input?.max_items !== expectedItems) throw new Error("governed content job differs from the authorized contract");
    const claimable = Number((await client.query("SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type IN ('campaign.strategy.generate','campaign.content.generate') AND status='queued' AND available_at<=now() AND attempt<max_attempts")).rows[0].count);
    if (claimable !== 1) throw new Error("content job is not the only claimable core work");
    await client.query("COMMIT");
    return { campaign_id: campaignId, content_job_id: job.id, requested_items: expectedItems };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function verifyContentReady() {
  await client.query("BEGIN READ ONLY");
  try {
    const result = await client.query(`SELECT c.status,
        (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.id=$2 AND j.campaign_id=c.id AND j.job_type='campaign.strategy.generate' AND j.status='succeeded') strategy_succeeded,
        (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.id=$4 AND j.campaign_id=c.id AND j.job_type='campaign.content.generate' AND j.status='queued' AND j.attempt=0 AND j.max_attempts=3 AND j.available_at<=now() AND (j.input->>'max_items')::int=$5) exact_content_ready,
        (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.job_type IN ('campaign.strategy.generate','campaign.content.generate') AND j.status='queued' AND j.available_at<=now() AND j.attempt<j.max_attempts) claimable_core_jobs,
        (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.status='running') running_jobs,
        (SELECT count(*)::int FROM tanaghom.content_items i WHERE i.campaign_id=c.id) content_items,
        (SELECT count(*)::int FROM tanaghom.external_operations x WHERE x.correlation_id IN (SELECT j.correlation_id FROM tanaghom.agent_jobs j WHERE j.campaign_id=c.id)) external_operations
      FROM tanaghom.campaigns c WHERE c.id=$1 AND c.name=$3`, [campaignId, strategyJobId, campaignName, contentJobId, expectedItems]);
    const row = result.rows[0];
    if (!row || row.status !== "strategy_ready" || row.strategy_succeeded !== 1 || row.exact_content_ready !== 1 || row.claimable_core_jobs !== 1 || row.running_jobs !== 0 || row.content_items || row.external_operations) throw new Error("the exact content job is not the sole safe claimable core work");
    await client.query("ROLLBACK");
    return row;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function completionSnapshot() {
  const result = await client.query(`SELECT c.id,c.status,c.budget_target,c.revenue_target,c.content_item_target,
      (SELECT count(*)::int FROM tanaghom.campaign_strategies s WHERE s.campaign_id=c.id) strategies,
      (SELECT count(*)::int FROM tanaghom.content_items i WHERE i.campaign_id=c.id) drafts,
      (SELECT count(*)::int FROM tanaghom.content_items i WHERE i.campaign_id=c.id AND i.status='pending_approval') pending,
      (SELECT count(*)::int FROM tanaghom.content_items i WHERE i.campaign_id=c.id AND i.status='approved') approved,
      (SELECT count(*)::int FROM tanaghom.content_approvals a JOIN tanaghom.content_items i ON i.id=a.content_item_id WHERE i.campaign_id=c.id) approvals,
      (SELECT count(*)::int FROM tanaghom.content_approvals a JOIN tanaghom.content_items i ON i.id=a.content_item_id JOIN tanaghom.app_users u ON u.id=a.decided_by WHERE i.campaign_id=c.id AND a.decision='approved' AND u.kind='human' AND u.is_active AND u.organization_id=c.organization_id) human_approvals,
      (SELECT count(*)::int FROM tanaghom.posts p JOIN tanaghom.content_items i ON i.id=p.content_item_id WHERE i.campaign_id=c.id) posts,
      (SELECT count(*)::int FROM tanaghom.leads l WHERE l.campaign_id=c.id) leads,
      (SELECT count(*)::int FROM tanaghom.external_operations x WHERE x.correlation_id IN (SELECT j.correlation_id FROM tanaghom.agent_jobs j WHERE j.campaign_id=c.id)) external_operations,
      (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.campaign_id=c.id AND j.job_type NOT IN ('campaign.strategy.generate','campaign.content.generate')) forbidden_jobs,
      (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.campaign_id=c.id AND j.job_type='campaign.strategy.generate' AND j.id=$2 AND j.status='succeeded') strategy_succeeded,
      (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.campaign_id=c.id AND j.job_type='campaign.content.generate' AND j.id=$4 AND j.status='waiting_approval' AND j.attempt=1 AND (j.input->>'max_items')::int=$5) content_waiting,
      (SELECT count(*)::int FROM tanaghom.agent_jobs j WHERE j.campaign_id=c.id AND j.job_type='campaign.content.generate' AND j.id=$4 AND j.status='succeeded' AND j.attempt=1 AND (j.input->>'max_items')::int=$5) content_succeeded,
      (SELECT count(*)::int FROM tanaghom.agent_actions_log l WHERE l.job_id=$4 AND l.action_type='content.review_completed' AND l.result='success') review_completed_audits
    FROM tanaghom.campaigns c WHERE c.id=$1 AND c.name=$3`, [campaignId, strategyJobId, campaignName, contentJobId, expectedItems]);
  if (result.rowCount !== 1) throw new Error("canary campaign not found");
  return result.rows[0];
}

function commonCompletion(row) {
  if (Number(row.budget_target) !== 0 || Number(row.revenue_target) !== 0 || row.content_item_target !== expectedItems) throw new Error("campaign business boundary changed");
  if (row.strategies !== 1 || row.drafts < 1 || row.drafts > expectedItems) throw new Error("strategy or draft count is outside the requested batch boundary");
  if (row.posts || row.leads || row.external_operations || row.forbidden_jobs || row.strategy_succeeded !== 1 || row.content_waiting + row.content_succeeded !== 1) throw new Error("canary job state or side-effect boundary is invalid");
}

async function verifyPending() {
  const row = await completionSnapshot(); commonCompletion(row);
  if (row.status !== "awaiting_approval" || row.pending !== row.drafts || row.approved || row.approvals || row.content_waiting !== 1 || row.content_succeeded || row.review_completed_audits) throw new Error("canary did not stop cleanly at human approval");
  return { ...row, requested_drafts: expectedItems, target_fulfilled: row.drafts === expectedItems };
}
async function verifyApproved() {
  const row = await completionSnapshot(); commonCompletion(row);
  if (row.pending || row.approved !== row.drafts || row.approvals !== row.drafts || row.human_approvals !== row.drafts || row.content_waiting || row.content_succeeded !== 1 || row.review_completed_audits !== 1) throw new Error("every generated draft must have an active human approval and one completed content job");
  return { ...row, requested_drafts: expectedItems, target_fulfilled: row.drafts === expectedItems };
}

try {
  let result;
  if (action === "check-database") result = await checkDatabase();
  else if (action === "verify-authorized") result = await verifyAuthorized();
  else if (action === "verify-strategy") result = await verifyStrategy();
  else if (action === "verify-resume-authorized") result = await verifyResumeAuthorized();
  else if (action === "queue-content") result = await queueContent();
  else if (action === "verify-content-ready") result = await verifyContentReady();
  else if (action === "verify-pending") result = await verifyPending();
  else result = await verifyApproved();
  console.log(JSON.stringify(result));
} finally { await client.end(); }
