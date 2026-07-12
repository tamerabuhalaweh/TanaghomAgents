import { randomUUID } from "node:crypto";
import pg from "pg";

const [action, campaignName] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!['seed', 'retry-strategist', 'queue-content', 'verify'].includes(action) || !campaignName?.endsWith('.test')) {
  throw new Error("usage: shadow-operator.mjs seed|retry-strategist|queue-content|verify NAME.test");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function seed() {
  await client.query('BEGIN');
  try {
    const existing = await client.query('SELECT id FROM tanaghom.campaigns WHERE name = $1', [campaignName]);
    if (existing.rowCount) throw new Error('shadow campaign name already exists');
    const owner = await client.query("SELECT id FROM tanaghom.app_users WHERE kind='human' AND role='owner' AND is_active ORDER BY created_at LIMIT 1");
    if (owner.rowCount !== 1) throw new Error('one active owner is required');
    const campaign = await client.query(`
      INSERT INTO tanaghom.campaigns
        (name, brief, product_type, target_audience, status, budget_target, revenue_target, currency, created_by)
      VALUES ($1, $2, 'camp', $3::jsonb, 'draft', 0, 0, 'USD', $4)
      RETURNING *
    `, [
      campaignName,
      'Shadow-only validation for Tanaghom. Prepare an organic awareness strategy for a fictional three-day family creativity camp in Amman. Do not publish, contact anyone, spend money, or claim real-world execution.',
      JSON.stringify({ geography: 'Amman, Jordan', age_range: 'Parents aged 28-50 with children aged 7-14', language: 'Arabic and English', test_only: true }),
      owner.rows[0].id,
    ]);
    await client.query(`
      INSERT INTO tanaghom.agents (code, name, description)
      VALUES
        ('campaign_strategist', 'Campaign Strategist', 'Builds bounded campaign strategy for human-governed operations.'),
        ('content_producer', 'Content Producer', 'Creates review-only content drafts from an approved strategy boundary.')
      ON CONFLICT (code) DO NOTHING
    `);
    const agent = await client.query("SELECT id FROM tanaghom.agents WHERE code='campaign_strategist' AND status <> 'disabled'");
    if (agent.rowCount !== 1) throw new Error('campaign strategist agent is unavailable');
    const jobId = randomUUID();
    const correlationId = randomUUID();
    const row = campaign.rows[0];
    const input = {
      contract_version: 'phase3.strategist-job.v1', job_id: jobId, correlation_id: correlationId,
      campaign: { id: row.id, name: row.name, brief: row.brief, product_type: row.product_type, target_audience: row.target_audience, budget_target: 0, revenue_target: 0, currency: row.currency },
    };
    await client.query(`
      INSERT INTO tanaghom.agent_jobs
        (id, correlation_id, agent_id, campaign_id, job_type, status, attempt, max_attempts, input)
      VALUES ($1,$2,$3,$4,'campaign.strategy.generate','queued',0,1,$5::jsonb)
    `, [jobId, correlationId, agent.rows[0].id, row.id, JSON.stringify(input)]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ campaign_id: row.id, strategist_job_id: jobId, correlation_id: correlationId }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function queueContent() {
  await client.query('BEGIN');
  try {
    const result = await client.query(`
      SELECT campaign.*, strategy.id AS strategy_id, strategy.version,
             strategy.positioning, strategy.key_messages, strategy.channels,
             strategy.posting_cadence, strategy.content_pillars
      FROM tanaghom.campaigns campaign
      JOIN LATERAL (
        SELECT * FROM tanaghom.campaign_strategies
        WHERE campaign_id=campaign.id ORDER BY version DESC LIMIT 1
      ) strategy ON true
      WHERE campaign.name=$1 AND campaign.status='strategy_ready'
      FOR UPDATE OF campaign
    `, [campaignName]);
    if (result.rowCount !== 1) throw new Error('strategy-ready shadow campaign not found');
    const agent = await client.query("SELECT id FROM tanaghom.agents WHERE code='content_producer' AND status <> 'disabled'");
    if (agent.rowCount !== 1) throw new Error('content producer agent is unavailable');
    const row = result.rows[0];
    const jobId = randomUUID();
    const correlationId = randomUUID();
    const input = {
      contract_version: 'phase3.content-producer-job.v1', job_id: jobId, correlation_id: correlationId,
      campaign: { id: row.id, name: row.name, brief: row.brief, product_type: row.product_type, target_audience: row.target_audience },
      strategy: { id: row.strategy_id, version: row.version, positioning: row.positioning, key_messages: row.key_messages, channels: row.channels, posting_cadence: row.posting_cadence, content_pillars: row.content_pillars },
      max_items: 2, regeneration: null,
    };
    await client.query(`
      INSERT INTO tanaghom.agent_jobs
        (id, correlation_id, agent_id, campaign_id, job_type, status, attempt, max_attempts, input)
      VALUES ($1,$2,$3,$4,'campaign.content.generate','queued',0,1,$5::jsonb)
    `, [jobId, correlationId, agent.rows[0].id, row.id, JSON.stringify(input)]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ campaign_id: row.id, content_job_id: jobId, correlation_id: correlationId }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function retryStrategist() {
  await client.query('BEGIN');
  try {
    const result = await client.query(`
      UPDATE tanaghom.agent_jobs job
      SET status='queued', attempt=0, started_at=NULL, finished_at=NULL,
          error_code=NULL, error_message=NULL, available_at=now()
      FROM tanaghom.campaigns campaign, tanaghom.agents agent
      WHERE job.campaign_id=campaign.id AND job.agent_id=agent.id
        AND campaign.name=$1 AND campaign.status='draft'
        AND agent.code='campaign_strategist'
        AND job.job_type='campaign.strategy.generate'
        AND job.status IN ('running','failed') AND job.attempt=1 AND job.max_attempts=1
        AND (job.status <> 'failed' OR job.error_code='gemma_request_error')
        AND NOT EXISTS (SELECT 1 FROM tanaghom.campaign_strategies strategy WHERE strategy.campaign_id=campaign.id)
      RETURNING job.id, job.agent_id
    `, [campaignName]);
    if (result.rowCount !== 1) throw new Error('one recoverable strategist job was expected');
    await client.query("UPDATE tanaghom.agents SET status='idle', last_heartbeat_at=now() WHERE id=$1", [result.rows[0].agent_id]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ strategist_job_id: result.rows[0].id, status: 'queued', attempt: 0 }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function verify() {
  const result = await client.query(`
    SELECT campaign.id, campaign.status, campaign.budget_target, campaign.revenue_target,
      (SELECT count(*)::int FROM tanaghom.campaign_strategies WHERE campaign_id=campaign.id) strategies,
      (SELECT count(*)::int FROM tanaghom.content_items WHERE campaign_id=campaign.id) content_items,
      (SELECT count(*)::int FROM tanaghom.content_items WHERE campaign_id=campaign.id AND status='pending_approval') pending_items,
      (SELECT count(*)::int FROM tanaghom.content_approvals a JOIN tanaghom.content_items c ON c.id=a.content_item_id WHERE c.campaign_id=campaign.id) approvals,
      (SELECT count(*)::int FROM tanaghom.posts p JOIN tanaghom.content_items c ON c.id=p.content_item_id WHERE c.campaign_id=campaign.id) posts,
      (SELECT count(*)::int FROM tanaghom.leads WHERE campaign_id=campaign.id) leads,
      (SELECT count(*)::int FROM tanaghom.external_operations o WHERE o.correlation_id IN (SELECT correlation_id FROM tanaghom.agent_jobs WHERE campaign_id=campaign.id)) external_operations,
      (SELECT jsonb_object_agg(job_type, status) FROM tanaghom.agent_jobs WHERE campaign_id=campaign.id) job_states
    FROM tanaghom.campaigns campaign WHERE campaign.name=$1
  `, [campaignName]);
  if (result.rowCount !== 1) throw new Error('shadow campaign not found');
  const row = result.rows[0];
  if (row.status !== 'awaiting_approval' || Number(row.budget_target) !== 0 || Number(row.revenue_target) !== 0) throw new Error('campaign did not stop at zero-budget approval gate');
  if (row.strategies !== 1 || row.content_items < 1 || row.content_items !== row.pending_items) throw new Error('strategy/draft evidence is invalid');
  if (row.approvals || row.posts || row.leads || row.external_operations) throw new Error('shadow run produced a forbidden side effect');
  if (row.job_states['campaign.strategy.generate'] !== 'succeeded' || row.job_states['campaign.content.generate'] !== 'waiting_approval') throw new Error('job states are invalid');
  console.log(JSON.stringify(row));
}

try {
  if (action === 'seed') await seed();
  else if (action === 'retry-strategist') await retryStrategist();
  else if (action === 'queue-content') await queueContent();
  else await verify();
} finally {
  await client.end();
}
