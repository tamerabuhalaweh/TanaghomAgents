\set ON_ERROR_STOP on
BEGIN;

WITH campaign AS (
  SELECT * FROM tanaghom.campaigns
  WHERE name = :'campaign_name' AND status = 'strategy_ready'
  ORDER BY created_at DESC LIMIT 1
), strategy AS (
  SELECT strategy.*
  FROM tanaghom.campaign_strategies strategy
  JOIN campaign ON campaign.id = strategy.campaign_id
  ORDER BY strategy.version DESC LIMIT 1
), job_values AS (
  SELECT gen_random_uuid() AS job_id, gen_random_uuid() AS correlation_id,
         campaign.*, strategy.id AS strategy_id, strategy.version,
         strategy.positioning, strategy.key_messages, strategy.channels,
         strategy.posting_cadence, strategy.content_pillars
  FROM campaign JOIN strategy ON strategy.campaign_id = campaign.id
)
INSERT INTO tanaghom.agent_jobs (
  id, correlation_id, agent_id, campaign_id, job_type, status,
  attempt, max_attempts, input
)
SELECT
  values.job_id, values.correlation_id, agent.id, values.id,
  'campaign.content.generate', 'queued', 0, 1,
  jsonb_build_object(
    'contract_version', 'phase3.content-producer-job.v1',
    'job_id', values.job_id,
    'correlation_id', values.correlation_id,
    'campaign', jsonb_build_object(
      'id', values.id, 'name', values.name, 'brief', values.brief,
      'product_type', values.product_type, 'target_audience', values.target_audience
    ),
    'strategy', jsonb_build_object(
      'id', values.strategy_id, 'version', values.version,
      'positioning', values.positioning, 'key_messages', values.key_messages,
      'channels', values.channels, 'posting_cadence', values.posting_cadence,
      'content_pillars', values.content_pillars
    ),
    'max_items', 2,
    'regeneration', NULL
  )
FROM job_values values
JOIN tanaghom.agents agent ON agent.code = 'content_producer'
RETURNING campaign_id, id AS content_job_id, correlation_id;

COMMIT;
