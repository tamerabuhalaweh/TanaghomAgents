\set ON_ERROR_STOP on

INSERT INTO tanaghom.publishing_channels (
  provider, channel, provider_integration_id, provider_settings
) VALUES (
  'postiz', 'instagram', 'integration-channel-1',
  '{"__type":"instagram","post_type":"post"}'
);

DO $$
DECLARE
  v_strategy_id uuid;
  v_approved_id uuid;
  v_pending_id uuid;
BEGIN
  SELECT id INTO v_strategy_id
  FROM tanaghom.campaign_strategies
  WHERE campaign_id = '20000000-0000-4000-8000-000000000001'
  ORDER BY version DESC LIMIT 1;

  INSERT INTO tanaghom.content_items (
    id, campaign_id, strategy_id, generation, channel, content_type,
    draft_copy, media_brief, status
  ) VALUES (
    '52000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', v_strategy_id, 201,
    'instagram', 'post', 'Approved Postiz fixture', 'No external media',
    'pending_approval'
  ) RETURNING id INTO v_approved_id;
  INSERT INTO tanaghom.content_approvals (content_item_id, decision, decided_by)
  VALUES (v_approved_id, 'approved', '00000000-0000-4000-8000-000000000001');
  UPDATE tanaghom.content_items SET status = 'approved' WHERE id = v_approved_id;

  INSERT INTO tanaghom.content_items (
    id, campaign_id, strategy_id, generation, channel, content_type,
    draft_copy, media_brief, status
  ) VALUES (
    '52000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001', v_strategy_id, 202,
    'instagram', 'post', 'Unapproved Postiz fixture', 'No external media',
    'pending_approval'
  ) RETURNING id INTO v_pending_id;
END;
$$;

SET ROLE tanaghom_api;

DO $$
DECLARE
  v_first record;
  v_replay record;
BEGIN
  SELECT * INTO v_first FROM tanaghom.queue_postiz_draft(
    '52000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  );
  SELECT * INTO v_replay FROM tanaghom.queue_postiz_draft(
    '52000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  );
  IF v_first.job_id IS NULL OR v_first.job_id <> v_replay.job_id
     OR v_first.job_status <> 'queued' THEN
    RAISE EXCEPTION 'Postiz queue request was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM tanaghom.queue_postiz_draft(
      '52000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'unapproved content unexpectedly queued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'unapproved content unexpectedly queued' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM tanaghom.prepare_postiz_draft(v_first.job_id);
    RAISE EXCEPTION 'API unexpectedly prepared a Postiz request';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
SET ROLE tanaghom_n8n_worker;

DO $$
DECLARE
  v_claimed record;
  v_prepared record;
  v_post_id uuid;
BEGIN
  SELECT * INTO v_claimed
  FROM tanaghom.claim_agent_job('publisher_monitor', ARRAY['content.postiz.draft']);
  IF v_claimed.job_id IS NULL THEN RAISE EXCEPTION 'publisher job was not claimed'; END IF;

  SELECT * INTO v_prepared FROM tanaghom.prepare_postiz_draft(v_claimed.job_id);
  IF v_prepared.request_body->>'type' <> 'draft'
     OR v_prepared.request_body#>>'{posts,0,integration,id}' <> 'integration-channel-1'
     OR v_prepared.request_body#>>'{posts,0,value,0,content}' <> 'Approved Postiz fixture' THEN
    RAISE EXCEPTION 'prepared Postiz request violated the draft contract';
  END IF;

  SELECT tanaghom.complete_postiz_draft(
    v_claimed.job_id, 'postiz-fixture-1',
    '{"postId":"postiz-fixture-1","integration":"integration-channel-1"}'
  ) INTO v_post_id;
  IF v_post_id IS NULL THEN RAISE EXCEPTION 'Postiz draft completion returned no post'; END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.agent_jobs
      WHERE job_type = 'content.postiz.draft'
        AND input->>'content_item_id' = '52000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'duplicate publisher job exists';
  END IF;
  IF (SELECT status FROM tanaghom.agent_jobs
      WHERE job_type = 'content.postiz.draft'
        AND input->>'content_item_id' = '52000000-0000-4000-8000-000000000001') <> 'succeeded' THEN
    RAISE EXCEPTION 'publisher job did not succeed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.posts
    WHERE content_item_id = '52000000-0000-4000-8000-000000000001'
      AND provider = 'postiz' AND provider_post_id = 'postiz-fixture-1'
      AND status = 'draft'
  ) THEN RAISE EXCEPTION 'Postiz draft record is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.external_operations
    WHERE idempotency_key = 'postiz-draft:52000000-0000-4000-8000-000000000001'
      AND status = 'succeeded'
  ) THEN RAISE EXCEPTION 'external operation did not succeed'; END IF;
  IF NOT has_function_privilege(
    'tanaghom_api', 'tanaghom.queue_postiz_draft(uuid,uuid)', 'EXECUTE'
  ) THEN RAISE EXCEPTION 'API queue grant is missing'; END IF;
  IF has_function_privilege(
    'tanaghom_api', 'tanaghom.prepare_postiz_draft(uuid)', 'EXECUTE'
  ) THEN RAISE EXCEPTION 'API unexpectedly has worker preparation access'; END IF;
  IF has_table_privilege(
    'tanaghom_n8n_worker', 'tanaghom.content_approvals', 'SELECT,INSERT,UPDATE,DELETE'
  ) THEN RAISE EXCEPTION 'worker gained approval table access'; END IF;
END;
$$;

DELETE FROM tanaghom.posts
WHERE content_item_id IN (
  '52000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000002'
);
DELETE FROM tanaghom.external_operations
WHERE idempotency_key = 'postiz-draft:52000000-0000-4000-8000-000000000001';

SELECT 'PASS: guarded Postiz draft handoff is idempotent and approval-bound.' AS result;
