\set ON_ERROR_STOP on
BEGIN;

WITH owner_user AS (
  SELECT id FROM tanaghom.app_users
  WHERE kind = 'human' AND role = 'owner' AND is_active
  ORDER BY created_at LIMIT 1
), inserted_campaign AS (
  INSERT INTO tanaghom.campaigns (
    name, brief, product_type, target_audience, status,
    budget_target, revenue_target, currency, created_by
  )
  SELECT
    :'campaign_name',
    'Shadow-only validation for Tanaghom. Prepare an organic awareness strategy for a fictional three-day family creativity camp in Amman. Do not publish, contact anyone, spend money, or claim real-world execution.',
    'camp',
    '{"geography":"Amman, Jordan","age_range":"Parents aged 28-50 with children aged 7-14","language":"Arabic and English","test_only":true}'::jsonb,
    'draft', 0, 0, 'USD', id
  FROM owner_user
  RETURNING *
), job_values AS (
  SELECT gen_random_uuid() AS job_id, gen_random_uuid() AS correlation_id, campaign.*
  FROM inserted_campaign campaign
)
INSERT INTO tanaghom.agent_jobs (
  id, correlation_id, agent_id, campaign_id, job_type, status,
  attempt, max_attempts, input
)
SELECT
  values.job_id, values.correlation_id, agent.id, values.id,
  'campaign.strategy.generate', 'queued', 0, 1,
  jsonb_build_object(
    'contract_version', 'phase3.strategist-job.v1',
    'job_id', values.job_id,
    'correlation_id', values.correlation_id,
    'campaign', jsonb_build_object(
      'id', values.id,
      'name', values.name,
      'brief', values.brief,
      'product_type', values.product_type,
      'target_audience', values.target_audience,
      'budget_target', values.budget_target,
      'revenue_target', values.revenue_target,
      'currency', values.currency
    )
  )
FROM job_values values
JOIN tanaghom.agents agent ON agent.code = 'campaign_strategist'
RETURNING campaign_id, id AS strategist_job_id, correlation_id;

COMMIT;
