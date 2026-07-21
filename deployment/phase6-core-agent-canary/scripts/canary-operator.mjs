#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import pg from "pg";

const [action, campaignName] = process.argv.slice(2);
const allowed = ["check-database", "seed", "queue-content", "verify-pending", "verify-approved", "mark-failed"];
const expectedMigration = process.env.TANAGHOM_EXPECTED_MIGRATION || "0023_campaign_lifecycle";
if (!["0023_campaign_lifecycle", "0024_conversation_intelligence_worker_registry", "0025_runtime_agent_reconciliation"].includes(expectedMigration)) {
  throw new Error("TANAGHOM_EXPECTED_MIGRATION is not an approved canary baseline");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!allowed.includes(action) || !campaignName?.endsWith(".test")) {
  throw new Error(`usage: canary-operator.mjs ${allowed.join("|")} NAME.test`);
}

const connectionUrl = new URL(process.env.DATABASE_URL);
if (process.env.TANAGHOM_DATABASE_SSL_MODE) {
  if (process.env.TANAGHOM_DATABASE_SSL_MODE !== "verify-full") throw new Error("TANAGHOM_DATABASE_SSL_MODE must be verify-full");
  connectionUrl.searchParams.set("sslmode", "verify-full");
}
const client = new pg.Client({ connectionString: connectionUrl.toString(), application_name: "tanaghom-core-canary" });
await client.connect();

async function owner() {
  const result = await client.query("SELECT id,organization_id FROM tanaghom.app_users WHERE kind='human' AND role='owner' AND is_active ORDER BY created_at LIMIT 1");
  if (result.rowCount !== 1) throw new Error("exactly one first active owner is required");
  return result.rows[0];
}

async function checkDatabase() {
  await client.query("BEGIN READ ONLY");
  try {
    const result = await client.query("SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1");
    if (result.rows[0]?.version !== expectedMigration) throw new Error("unexpected database migration during Node TLS check");
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ database_tls: "verified", transaction: "read_only", migration: result.rows[0].version }));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function seed() {
  await client.query("BEGIN");
  try {
    if ((await client.query("SELECT 1 FROM tanaghom.campaigns WHERE name=$1", [campaignName])).rowCount) throw new Error("canary campaign already exists");
    const human = await owner();
    const campaign = (await client.query(`
      INSERT INTO tanaghom.campaigns
        (name,brief,product_type,target_audience,status,budget_target,revenue_target,currency,created_by)
      VALUES ($1,$2,'camp',$3::jsonb,'draft',0,0,'USD',$4) RETURNING *`, [
      campaignName,
      "Controlled Tanaghom canary only. Prepare an organic awareness strategy for a fictional three-day family creativity camp in Amman. Never publish, contact a person, create a CRM record, spend money, or claim real-world execution.",
      JSON.stringify({ geography: "Amman, Jordan", audience: "Fictional parents aged 28-50 with children aged 7-14", languages: ["Arabic", "English"], test_only: true }),
      human.id,
    ])).rows[0];
    const agent = (await client.query("SELECT id FROM tanaghom.agents WHERE code='campaign_strategist' AND status<>'disabled'")).rows[0];
    if (!agent) throw new Error("campaign strategist is unavailable");
    const jobId = randomUUID();
    const correlationId = randomUUID();
    const input = {
      contract_version: "phase3.strategist-job.v1", job_id: jobId, correlation_id: correlationId,
      campaign: { id: campaign.id, name: campaign.name, brief: campaign.brief, product_type: campaign.product_type, target_audience: campaign.target_audience, budget_target: 0, revenue_target: 0, currency: "USD" },
    };
    await client.query(`INSERT INTO tanaghom.agent_jobs
      (id,correlation_id,agent_id,campaign_id,job_type,status,attempt,max_attempts,input)
      VALUES ($1,$2,$3,$4,'campaign.strategy.generate','queued',0,1,$5::jsonb)`,
    [jobId, correlationId, agent.id, campaign.id, JSON.stringify(input)]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ campaign_id: campaign.id, strategist_job_id: jobId }));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function queueContent() {
  await client.query("BEGIN");
  try {
    const row = (await client.query(`SELECT c.*,s.id strategy_id,s.version,s.positioning,s.key_messages,s.channels,s.posting_cadence,s.content_pillars
      FROM tanaghom.campaigns c JOIN LATERAL
      (SELECT * FROM tanaghom.campaign_strategies WHERE campaign_id=c.id ORDER BY version DESC LIMIT 1) s ON true
      WHERE c.name=$1 AND c.status='strategy_ready' FOR UPDATE OF c`, [campaignName])).rows[0];
    if (!row) throw new Error("one strategy-ready canary campaign is required");
    const agent = (await client.query("SELECT id FROM tanaghom.agents WHERE code='content_producer' AND status<>'disabled'")).rows[0];
    if (!agent) throw new Error("content producer is unavailable");
    const jobId = randomUUID();
    const correlationId = randomUUID();
    const input = {
      contract_version: "phase3.content-producer-job.v1", job_id: jobId, correlation_id: correlationId,
      campaign: { id: row.id, name: row.name, brief: row.brief, product_type: row.product_type, target_audience: row.target_audience },
      strategy: { id: row.strategy_id, version: row.version, positioning: row.positioning, key_messages: row.key_messages, channels: row.channels, posting_cadence: row.posting_cadence, content_pillars: row.content_pillars },
      max_items: 2,
    };
    await client.query(`INSERT INTO tanaghom.agent_jobs
      (id,correlation_id,agent_id,campaign_id,job_type,status,attempt,max_attempts,input)
      VALUES ($1,$2,$3,$4,'campaign.content.generate','queued',0,1,$5::jsonb)`,
    [jobId, correlationId, agent.id, row.id, JSON.stringify(input)]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ campaign_id: row.id, content_job_id: jobId }));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function snapshot() {
  const result = await client.query(`SELECT c.id,c.status,c.budget_target,c.revenue_target,
    (SELECT count(*)::int FROM tanaghom.campaign_strategies WHERE campaign_id=c.id) strategies,
    (SELECT count(*)::int FROM tanaghom.content_items WHERE campaign_id=c.id) drafts,
    (SELECT count(*)::int FROM tanaghom.content_items WHERE campaign_id=c.id AND status='pending_approval') pending,
    (SELECT count(*)::int FROM tanaghom.content_items WHERE campaign_id=c.id AND status='approved') approved,
    (SELECT count(*)::int FROM tanaghom.content_approvals a JOIN tanaghom.content_items i ON i.id=a.content_item_id WHERE i.campaign_id=c.id) approvals,
    (SELECT count(*)::int FROM tanaghom.content_approvals a JOIN tanaghom.content_items i ON i.id=a.content_item_id JOIN tanaghom.app_users u ON u.id=a.decided_by WHERE i.campaign_id=c.id AND a.decision='approved' AND u.kind='human' AND u.is_active AND u.organization_id=(SELECT organization_id FROM tanaghom.app_users WHERE id=c.created_by)) human_approvals,
    (SELECT count(*)::int FROM tanaghom.posts p JOIN tanaghom.content_items i ON i.id=p.content_item_id WHERE i.campaign_id=c.id) posts,
    (SELECT count(*)::int FROM tanaghom.leads WHERE campaign_id=c.id) leads,
    (SELECT count(*)::int FROM tanaghom.external_operations o WHERE o.correlation_id IN (SELECT correlation_id FROM tanaghom.agent_jobs WHERE campaign_id=c.id)) external_operations,
    (SELECT count(*)::int FROM tanaghom.agent_jobs WHERE campaign_id=c.id AND job_type NOT IN ('campaign.strategy.generate','campaign.content.generate')) forbidden_jobs,
    (SELECT jsonb_object_agg(job_type,status) FROM tanaghom.agent_jobs WHERE campaign_id=c.id) job_states
    FROM tanaghom.campaigns c WHERE c.name=$1`, [campaignName]);
  if (result.rowCount !== 1) throw new Error("canary campaign not found");
  return result.rows[0];
}

function commonVerify(row) {
  if (Number(row.budget_target) !== 0 || Number(row.revenue_target) !== 0) throw new Error("canary budget or revenue target is non-zero");
  if (row.strategies !== 1 || row.drafts < 1 || row.drafts > 2) throw new Error("strategy or draft count is outside the canary boundary");
  if (row.posts || row.leads || row.external_operations || row.forbidden_jobs) throw new Error("canary produced a forbidden side effect");
  if (row.job_states["campaign.strategy.generate"] !== "succeeded" || row.job_states["campaign.content.generate"] !== "waiting_approval") throw new Error("core job states are invalid");
}

async function verifyPending() {
  const row = await snapshot();
  commonVerify(row);
  if (row.status !== "awaiting_approval" || row.pending !== row.drafts || row.approved || row.approvals) throw new Error("canary did not stop cleanly at human approval");
  console.log(JSON.stringify(row));
}

async function verifyApproved() {
  const row = await snapshot();
  commonVerify(row);
  if (row.pending || row.approved !== row.drafts || row.approvals !== row.drafts || row.human_approvals !== row.drafts) throw new Error("every canary draft must have an active human approval");
  console.log(JSON.stringify(row));
}

async function markFailed() {
  await client.query(`UPDATE tanaghom.campaigns SET status='failed'
    WHERE name=$1 AND status IN ('draft','strategy_ready')
      AND NOT EXISTS (SELECT 1 FROM tanaghom.content_items WHERE campaign_id=campaigns.id)`, [campaignName]);
  console.log(JSON.stringify({ campaign: campaignName, marked_failed_if_safe: true }));
}

try {
  if (action === "check-database") await checkDatabase();
  else if (action === "seed") await seed();
  else if (action === "queue-content") await queueContent();
  else if (action === "verify-pending") await verifyPending();
  else if (action === "verify-approved") await verifyApproved();
  else await markFailed();
} finally { await client.end(); }
