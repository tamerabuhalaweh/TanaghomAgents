\set ON_ERROR_STOP on

INSERT INTO tanaghom.agent_jobs (
  id, correlation_id, agent_id, campaign_id, job_type, input
) VALUES (
  '50000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'campaign.strategy.generate',
  '{"contract_version":"phase3.strategist-job.v1"}'
);

SET ROLE tanaghom_n8n_worker;

DO $$
DECLARE claimed record;
BEGIN
  SELECT * INTO claimed
  FROM tanaghom.claim_agent_job('campaign_strategist', ARRAY['campaign.strategy.generate']);
  IF claimed.job_id <> '50000000-0000-4000-8000-000000000001' OR claimed.attempt <> 1 THEN
    RAISE EXCEPTION 'strategist claim returned the wrong job';
  END IF;
END;
$$;

SELECT tanaghom.persist_strategy_result(
  '50000000-0000-4000-8000-000000000001',
  '{
    "contract_version":"phase3.strategist-output.v1",
    "status":"ok",
    "positioning":"A grounded test position",
    "key_messages":["one","two","three"],
    "channels":["instagram"],
    "posting_cadence":{"instagram":{"posts_per_week":1}},
    "content_pillars":[
      {"name":"Proof","description":"Evidence","example_angles":["A"]},
      {"name":"People","description":"Audience","example_angles":["B"]},
      {"name":"Process","description":"Method","example_angles":["C"]},
      {"name":"Offer","description":"Value","example_angles":["D"]}
    ]
  }'::jsonb,
  'gemma-test',
  'campaign-strategist/v1'
);

RESET ROLE;

DO $$
BEGIN
  IF (SELECT status FROM tanaghom.agent_jobs WHERE id = '50000000-0000-4000-8000-000000000001') <> 'succeeded' THEN
    RAISE EXCEPTION 'strategist job was not completed';
  END IF;
  IF (SELECT status FROM tanaghom.campaigns WHERE id = '20000000-0000-4000-8000-000000000001') <> 'strategy_ready' THEN
    RAISE EXCEPTION 'campaign was not advanced to strategy_ready';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.campaign_strategies
    WHERE campaign_id = '20000000-0000-4000-8000-000000000001'
      AND model_name = 'gemma-test' AND prompt_version = 'campaign-strategist/v1'
  ) THEN RAISE EXCEPTION 'strategy provenance was not persisted'; END IF;
  IF (SELECT count(*) FROM tanaghom.outbox_events WHERE event_key = 'strategy.persisted:50000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'strategy outbox event missing';
  END IF;
END;
$$;

INSERT INTO tanaghom.agent_jobs (
  id, correlation_id, agent_id, campaign_id, job_type, input
) VALUES (
  '50000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  'campaign.content.generate',
  '{"contract_version":"phase3.content-producer-job.v1","max_items":1}'
);

SET ROLE tanaghom_n8n_worker;
SELECT job_id FROM tanaghom.claim_agent_job('content_producer', ARRAY['campaign.content.generate']);
SELECT tanaghom.persist_content_result(
  '50000000-0000-4000-8000-000000000002',
  '{
    "contract_version":"phase3.content-producer-output.v1",
    "items":[{
      "channel":"instagram",
      "content_type":"post",
      "content_pillar":"Proof",
      "draft_copy":"A truthful draft for human review.",
      "media_brief":"A simple evidence-led visual.",
      "scheduled_time_suggestion":null
    }]
  }'::jsonb,
  'gemma-test',
  'content-producer/v1'
);
DO $$ BEGIN
  IF tanaghom.complete_content_job('50000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'content job completed without a human decision';
  END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT status FROM tanaghom.agent_jobs WHERE id = '50000000-0000-4000-8000-000000000002') <> 'waiting_approval' THEN
    RAISE EXCEPTION 'content job bypassed waiting approval';
  END IF;
  IF (SELECT status FROM tanaghom.campaigns WHERE id = '20000000-0000-4000-8000-000000000001') <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'campaign was not advanced to awaiting approval';
  END IF;
  IF (SELECT count(*) FROM tanaghom.content_items WHERE campaign_id = '20000000-0000-4000-8000-000000000001' AND draft_copy = 'A truthful draft for human review.' AND status = 'pending_approval') <> 1 THEN
    RAISE EXCEPTION 'pending content was not persisted exactly once';
  END IF;
  IF (SELECT count(*) FROM tanaghom.content_approvals WHERE content_item_id IN (
    SELECT id FROM tanaghom.content_items WHERE draft_copy = 'A truthful draft for human review.'
  )) <> 0 THEN RAISE EXCEPTION 'worker function forged a human approval'; END IF;
END;
$$;

SET ROLE tanaghom_api;
DO $$
DECLARE v_content_id uuid;
BEGIN
  SELECT id INTO v_content_id FROM tanaghom.content_items
  WHERE draft_copy = 'A truthful draft for human review.';
  INSERT INTO tanaghom.content_approvals (content_item_id, decision, decided_by)
  VALUES (v_content_id, 'approved', '00000000-0000-4000-8000-000000000001');
  UPDATE tanaghom.content_items SET status = 'approved' WHERE id = v_content_id;
END;
$$;
RESET ROLE;

SET ROLE tanaghom_n8n_worker;
DO $$ BEGIN
  IF NOT tanaghom.complete_content_job('50000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'content job did not complete after human decision';
  END IF;
END $$;
RESET ROLE;

INSERT INTO tanaghom.agent_jobs (
  id, correlation_id, agent_id, campaign_id, job_type, input, max_attempts
) VALUES (
  '50000000-0000-4000-8000-000000000003',
  '51000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'campaign.strategy.generate', '{}', 2
);

SET ROLE tanaghom_n8n_worker;
SELECT job_id FROM tanaghom.claim_agent_job('campaign_strategist', NULL);
DO $$ BEGIN
  IF tanaghom.record_agent_job_failure(
    '50000000-0000-4000-8000-000000000003', 'gemma_timeout', 'bounded test failure', 0
  ) <> 'queued' THEN RAISE EXCEPTION 'first failure was not retried'; END IF;
END $$;
SELECT job_id FROM tanaghom.claim_agent_job('campaign_strategist', NULL);
DO $$ BEGIN
  IF tanaghom.record_agent_job_failure(
    '50000000-0000-4000-8000-000000000003', 'gemma_timeout', 'bounded test failure', 0
  ) <> 'failed' THEN RAISE EXCEPTION 'exhausted failure was not final'; END IF;
END $$;
RESET ROLE;

INSERT INTO tanaghom.campaigns (
  id, name, brief, product_type, target_audience, created_by
) VALUES (
  '20000000-0000-4000-8000-000000000002', 'Blocked Contract Test',
  'Intentionally incomplete', 'course', '{}',
  '00000000-0000-4000-8000-000000000001'
);
INSERT INTO tanaghom.agent_jobs (
  id, correlation_id, agent_id, campaign_id, job_type, input
) VALUES (
  '50000000-0000-4000-8000-000000000004',
  '51000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'campaign.strategy.generate', '{}'
);
SET ROLE tanaghom_n8n_worker;
SELECT job_id FROM tanaghom.claim_agent_job('campaign_strategist', NULL);
SELECT tanaghom.persist_strategy_result(
  '50000000-0000-4000-8000-000000000004',
  '{"contract_version":"phase3.strategist-output.v1","status":"blocked_missing_info","missing_fields":["target_audience.geographies"],"message":"Target geography is required."}',
  'gemma-test', 'campaign-strategist/v1'
);
RESET ROLE;

SET ROLE tanaghom_readonly;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM tanaghom.claim_agent_job('campaign_strategist', NULL);
    RAISE EXCEPTION 'readonly worker-function execution unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT status FROM tanaghom.agent_jobs WHERE id = '50000000-0000-4000-8000-000000000003') <> 'failed' THEN
    RAISE EXCEPTION 'exhausted job is not failed';
  END IF;
  IF (SELECT status FROM tanaghom.campaigns WHERE id = '20000000-0000-4000-8000-000000000002') <> 'blocked_missing_info' THEN
    RAISE EXCEPTION 'missing input did not visibly block campaign';
  END IF;
  IF NOT has_function_privilege('tanaghom_n8n_worker', 'tanaghom.claim_agent_job(text,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'n8n claim execution grant missing';
  END IF;
  IF has_function_privilege('tanaghom_readonly', 'tanaghom.claim_agent_job(text,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'readonly unexpectedly has worker execution';
  END IF;
  IF has_table_privilege('tanaghom_n8n_worker', 'tanaghom.content_approvals', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'worker gained approval table privileges';
  END IF;
END;
$$;

SELECT 'PASS: controlled worker functions preserve Phase 3 boundaries.' AS result;
