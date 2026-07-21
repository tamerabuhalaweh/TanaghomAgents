\set ON_ERROR_STOP on

INSERT INTO tanaghom.app_users (
  id, email, display_name, kind, role, auth_subject, accepted_at, organization_id
) VALUES
  ('00000000-0000-4000-8000-000000000010', 'operator@example.test', 'Lifecycle Operator',
   'human', 'operator', '90000000-0000-4000-8000-000000000010', now(),
   '10000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000011', 'viewer@example.test', 'Lifecycle Viewer',
   'human', 'viewer', '90000000-0000-4000-8000-000000000011', now(),
   '10000000-0000-4000-8000-000000000001');

SET ROLE tanaghom_api;

SELECT * FROM tanaghom.create_campaign_draft(
  '00000000-0000-4000-8000-000000000010',
  'Dashboard lifecycle campaign.test',
  'Create an organic, zero-budget campaign for a fictional family creativity workshop. Never publish, contact a person, or claim external execution.',
  'course',
  '{"audience":"Parents aged 28 to 50 with children aged 7 to 14","geography":"Amman, Jordan","languages":["en","ar"],"test_only":true}',
  0, 0, 'usd', 1
);

DO $$
DECLARE v_campaign_id uuid;
BEGIN
  SELECT id INTO v_campaign_id FROM tanaghom.campaigns
  WHERE name = 'Dashboard lifecycle campaign.test';
  IF v_campaign_id IS NULL THEN RAISE EXCEPTION 'campaign draft was not created'; END IF;
  IF (SELECT organization_id FROM tanaghom.campaigns WHERE id=v_campaign_id)
      <> '10000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'campaign was not tenant-bound';
  END IF;
  IF (SELECT content_item_target FROM tanaghom.campaigns WHERE id=v_campaign_id) <> 1 THEN
    RAISE EXCEPTION 'content target was not stored';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_actions_log
    WHERE entity_id=v_campaign_id AND action_type='campaign.created'
  ) THEN RAISE EXCEPTION 'campaign creation audit missing'; END IF;

  BEGIN
    INSERT INTO tanaghom.campaigns
      (name,brief,product_type,target_audience,created_by,organization_id)
    VALUES ('Forbidden direct campaign','This direct API write must fail.','course','{}',
      '00000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'API direct campaign insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM * FROM tanaghom.queue_campaign_strategy(
      v_campaign_id, '00000000-0000-4000-8000-000000000011');
    RAISE EXCEPTION 'viewer unexpectedly queued strategy work';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'viewer unexpectedly queued strategy work' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

BEGIN;
INSERT INTO tanaghom.organizations (id, slug, name)
VALUES ('10000000-0000-4000-8000-000000000099', 'other-lifecycle-test', 'Other Lifecycle Test');
INSERT INTO tanaghom.app_users (
  id, email, display_name, kind, role, auth_subject, accepted_at, organization_id
) VALUES (
  '00000000-0000-4000-8000-000000000099', 'other-operator@example.test', 'Other Operator',
  'human', 'operator', '90000000-0000-4000-8000-000000000099', now(),
  '10000000-0000-4000-8000-000000000099'
);
SET ROLE tanaghom_api;

SELECT * FROM tanaghom.create_campaign_draft(
  '00000000-0000-4000-8000-000000000099',
  'Other tenant lifecycle campaign.test',
  'A complete but isolated campaign brief for another disposable tenant only.',
  'book',
  '{"audience":"Fictional adult readers aged 25 to 60","geography":"Dubai, UAE","languages":["en"]}',
  0, 0, 'AED', 1
);

DO $$
DECLARE v_other_campaign_id uuid;
BEGIN
  SELECT id INTO v_other_campaign_id FROM tanaghom.campaigns
  WHERE name='Other tenant lifecycle campaign.test';
  BEGIN
    PERFORM * FROM tanaghom.queue_campaign_strategy(
      v_other_campaign_id, '00000000-0000-4000-8000-000000000010');
    RAISE EXCEPTION 'cross-tenant strategy queue unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-tenant strategy queue unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;
ROLLBACK;
SET ROLE tanaghom_api;

SELECT * FROM tanaghom.queue_campaign_strategy(
  (SELECT id FROM tanaghom.campaigns WHERE name='Dashboard lifecycle campaign.test'),
  '00000000-0000-4000-8000-000000000010'
);
SELECT * FROM tanaghom.queue_campaign_strategy(
  (SELECT id FROM tanaghom.campaigns WHERE name='Dashboard lifecycle campaign.test'),
  '00000000-0000-4000-8000-000000000010'
);

RESET ROLE;

DO $$
DECLARE v_campaign_id uuid;
BEGIN
  SELECT id INTO v_campaign_id FROM tanaghom.campaigns
  WHERE name='Dashboard lifecycle campaign.test';
  IF (SELECT count(*) FROM tanaghom.agent_jobs
      WHERE campaign_id=v_campaign_id AND job_type='campaign.strategy.generate'
        AND status IN ('queued','running','waiting_approval')) <> 1 THEN
    RAISE EXCEPTION 'strategy queue was not idempotent at the database boundary';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_jobs job
    WHERE job.campaign_id=v_campaign_id
      AND job.input->>'contract_version'='phase3.strategist-job.v1'
      AND job.input->>'job_id'=job.id::text
      AND job.input->>'correlation_id'=job.correlation_id::text
      AND job.input->'campaign'->>'id'=v_campaign_id::text
      AND job.input->'campaign'->>'currency'='USD'
  ) THEN RAISE EXCEPTION 'strategist payload does not match the v1 contract'; END IF;
END;
$$;

SET ROLE tanaghom_n8n_worker;
DO $$
DECLARE v_claim record;
BEGIN
  SELECT * INTO v_claim FROM tanaghom.claim_agent_job(
    'campaign_strategist', ARRAY['campaign.strategy.generate']);
  IF v_claim.campaign_id <> (
    SELECT id FROM tanaghom.campaigns WHERE name='Dashboard lifecycle campaign.test'
  ) THEN RAISE EXCEPTION 'lifecycle strategist job was not claimed'; END IF;

  PERFORM tanaghom.persist_strategy_result(
    v_claim.job_id,
    '{
      "contract_version":"phase3.strategist-output.v1",
      "status":"ok",
      "positioning":"A safe, family-centered creativity position",
      "key_messages":["Create together","Learn through play","Build lasting confidence"],
      "channels":["instagram"],
      "posting_cadence":{"instagram":{"posts_per_week":2}},
      "content_pillars":[
        {"name":"Creativity","description":"Practical creativity","example_angles":["Family exercise"]},
        {"name":"Confidence","description":"Confidence outcomes","example_angles":["Small wins"]},
        {"name":"Community","description":"Shared learning","example_angles":["Parent stories"]},
        {"name":"Workshop","description":"Workshop format","example_angles":["What to expect"]}
      ]
    }'::jsonb,
    'gemma-test', 'campaign-strategist/v1'
  );
END;
$$;
RESET ROLE;

SET ROLE tanaghom_api;
SELECT * FROM tanaghom.queue_campaign_content(
  (SELECT id FROM tanaghom.campaigns WHERE name='Dashboard lifecycle campaign.test'),
  '00000000-0000-4000-8000-000000000010'
);
SELECT * FROM tanaghom.queue_campaign_content(
  (SELECT id FROM tanaghom.campaigns WHERE name='Dashboard lifecycle campaign.test'),
  '00000000-0000-4000-8000-000000000010'
);
RESET ROLE;

DO $$
DECLARE v_campaign_id uuid;
BEGIN
  SELECT id INTO v_campaign_id FROM tanaghom.campaigns
  WHERE name='Dashboard lifecycle campaign.test';
  IF (SELECT count(*) FROM tanaghom.agent_jobs
      WHERE campaign_id=v_campaign_id AND job_type='campaign.content.generate'
        AND status IN ('queued','running','waiting_approval')) <> 1 THEN
    RAISE EXCEPTION 'content queue was not idempotent at the database boundary';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_jobs job
    WHERE job.campaign_id=v_campaign_id
      AND job.input->>'contract_version'='phase3.content-producer-job.v1'
      AND job.input->>'job_id'=job.id::text
      AND job.input->>'correlation_id'=job.correlation_id::text
      AND (job.input->>'max_items')::integer=1
      AND job.input->'strategy'->>'id' IS NOT NULL
  ) THEN RAISE EXCEPTION 'content payload does not match the v1 contract'; END IF;
END;
$$;

SET ROLE tanaghom_n8n_worker;
DO $$
DECLARE v_claim record;
BEGIN
  SELECT * INTO v_claim FROM tanaghom.claim_agent_job(
    'content_producer', ARRAY['campaign.content.generate']);
  IF v_claim.campaign_id <> (
    SELECT id FROM tanaghom.campaigns WHERE name='Dashboard lifecycle campaign.test'
  ) THEN RAISE EXCEPTION 'lifecycle content job was not claimed'; END IF;

  PERFORM tanaghom.persist_content_result(
    v_claim.job_id,
    '{
      "contract_version":"phase3.content-producer-output.v1",
      "items":[{
        "channel":"instagram",
        "content_type":"post",
        "content_pillar":"Creativity",
        "draft_copy":"A safe lifecycle draft awaiting human review.",
        "media_brief":"A warm family creativity workshop scene.",
        "scheduled_time_suggestion":null
      }]
    }'::jsonb,
    'gemma-test', 'content-producer/v1'
  );
END;
$$;
RESET ROLE;

SET ROLE tanaghom_api;
DO $$
DECLARE v_campaign_id uuid;
DECLARE v_content_id uuid;
DECLARE v_reconciled record;
BEGIN
  SELECT id INTO v_campaign_id FROM tanaghom.campaigns
  WHERE name='Dashboard lifecycle campaign.test';
  SELECT id INTO v_content_id FROM tanaghom.content_items
  WHERE campaign_id=v_campaign_id AND status='pending_approval';

  INSERT INTO tanaghom.content_approvals (content_item_id,decision,decided_by)
  VALUES (v_content_id,'approved','00000000-0000-4000-8000-000000000001');
  UPDATE tanaghom.content_items SET status='approved' WHERE id=v_content_id;

  PERFORM * FROM tanaghom.mark_campaign_ready(
    v_campaign_id,'00000000-0000-4000-8000-000000000010');

  SELECT * INTO v_reconciled FROM tanaghom.reconcile_campaign_content_jobs(
    v_campaign_id,'00000000-0000-4000-8000-000000000001');
  IF v_reconciled.completed_jobs <> 0 OR NOT v_reconciled.ready_for_handoff THEN
    RAISE EXCEPTION 'ready transition did not reconcile the reviewed content job';
  END IF;
END;
$$;
RESET ROLE;

DO $$
DECLARE v_campaign_id uuid;
BEGIN
  SELECT id INTO v_campaign_id FROM tanaghom.campaigns
  WHERE name='Dashboard lifecycle campaign.test';
  IF (SELECT status FROM tanaghom.campaigns WHERE id=v_campaign_id) <> 'active' THEN
    RAISE EXCEPTION 'campaign did not reach the explicit ready state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tanaghom.agent_jobs
    WHERE campaign_id=v_campaign_id
      AND job_type NOT IN ('campaign.strategy.generate','campaign.content.generate')
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.posts post
    JOIN tanaghom.content_items content ON content.id=post.content_item_id
    WHERE content.campaign_id=v_campaign_id
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.external_operations operation
    WHERE operation.correlation_id IN (
      SELECT correlation_id FROM tanaghom.agent_jobs WHERE campaign_id=v_campaign_id
    )
  ) THEN RAISE EXCEPTION 'campaign lifecycle produced a forbidden external side effect'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_actions_log
    WHERE entity_id=v_campaign_id AND action_type='campaign.ready_for_handoff'
  ) THEN RAISE EXCEPTION 'ready transition audit missing'; END IF;

  IF has_table_privilege('tanaghom_api','tanaghom.campaigns','INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'API gained direct campaign table writes';
  END IF;
  IF has_table_privilege('tanaghom_n8n_worker','tanaghom.content_approvals','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'n8n gained human approval privileges';
  END IF;
  IF has_function_privilege('tanaghom_n8n_worker','tanaghom.create_campaign_draft(uuid,text,text,text,jsonb,numeric,numeric,text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'n8n gained campaign creation execution';
  END IF;
  IF NOT has_function_privilege('tanaghom_api','tanaghom.queue_campaign_strategy(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('tanaghom_api','tanaghom.queue_campaign_content(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'API lifecycle execution grants are missing';
  END IF;
END;
$$;

SELECT 'PASS: controlled campaign lifecycle is tenant-bound, idempotent, audited, and provider-free.' AS result;
