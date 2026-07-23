\set ON_ERROR_STOP on

DO $$
DECLARE
  strategy_id uuid;
  content_id uuid;
  pending_content_id uuid;
  correlation uuid := '30000000-0000-4000-8000-000000000001';
BEGIN
  IF (SELECT count(*) FROM tanaghom.agents) <> 4 THEN
    RAISE EXCEPTION 'expected four seeded agents';
  END IF;

  BEGIN
    INSERT INTO tanaghom.app_users (
      email, display_name, kind, role, auth_subject, accepted_at
    ) VALUES (
      'duplicate-subject@example.test', 'Duplicate Subject', 'human', 'reviewer',
      '90000000-0000-4000-8000-000000000001', now()
    );
    RAISE EXCEPTION 'duplicate auth subject unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO tanaghom.app_users (
      email, display_name, kind, role, auth_subject
    ) VALUES (
      'service-subject@example.test', 'Invalid Service Subject', 'service', 'service',
      '90000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'service auth subject unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO tanaghom.campaign_strategies (
    campaign_id, version, positioning, key_messages, channels,
    posting_cadence, content_pillars, model_name, prompt_version
  ) VALUES (
    '20000000-0000-4000-8000-000000000001', 1, 'Staging positioning',
    '["safe"]', '["instagram"]', '{"instagram":{"posts_per_week":1}}', '["growth"]',
    'fixture-model', 'test-v1'
  ) RETURNING id INTO strategy_id;

  INSERT INTO tanaghom.content_items (
    campaign_id, strategy_id, channel, content_type, draft_copy, media_brief,
    status
  ) VALUES (
    '20000000-0000-4000-8000-000000000001', strategy_id, 'instagram',
    'post', 'Fixture draft', 'Fixture visual', 'pending_approval'
  ) RETURNING id INTO content_id;

  BEGIN
    UPDATE tanaghom.content_items SET status = 'approved' WHERE id = content_id;
    RAISE EXCEPTION 'approval bypass unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'approval bypass unexpectedly succeeded' THEN RAISE; END IF;
  END;

  INSERT INTO tanaghom.content_approvals (content_item_id, decision, decided_by)
  VALUES (content_id, 'approved', '00000000-0000-4000-8000-000000000001');
  UPDATE tanaghom.content_items SET status = 'approved' WHERE id = content_id;

  IF (SELECT status FROM tanaghom.content_items WHERE id = content_id) <> 'approved' THEN
    RAISE EXCEPTION 'human approval was not applied';
  END IF;

  BEGIN
    UPDATE tanaghom.content_items SET status = 'draft' WHERE id = content_id;
    RAISE EXCEPTION 'invalid content transition unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'invalid content transition unexpectedly succeeded' THEN RAISE; END IF;
  END;

  INSERT INTO tanaghom.content_items (
    campaign_id, strategy_id, channel, content_type, draft_copy, media_brief,
    status
  ) VALUES (
    '20000000-0000-4000-8000-000000000001', strategy_id, 'instagram',
    'post', 'Unapproved fixture draft', 'Fixture visual', 'pending_approval'
  ) RETURNING id INTO pending_content_id;

  BEGIN
    INSERT INTO tanaghom.posts (content_item_id, provider_post_id, channel, status)
    VALUES (pending_content_id, 'must-not-exist', 'instagram', 'scheduled');
    RAISE EXCEPTION 'unapproved post unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'unapproved post unexpectedly succeeded' THEN RAISE; END IF;
  END;

  INSERT INTO tanaghom.posts (content_item_id, provider_post_id, channel, status)
  VALUES (content_id, 'fixture-approved-post', 'instagram', 'scheduled');

  BEGIN
    UPDATE tanaghom.campaigns SET status = 'active'
    WHERE id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'invalid campaign transition unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'invalid campaign transition unexpectedly succeeded' THEN RAISE; END IF;
  END;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, agent_id, action_type, entity_type, entity_id, result
  ) VALUES (
    correlation, '10000000-0000-4000-8000-000000000002', 'content.generated',
    'content_item', content_id, 'success'
  );

  BEGIN
    UPDATE tanaghom.agent_actions_log SET result = 'failed' WHERE correlation_id = correlation;
    RAISE EXCEPTION 'audit update unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'audit update unexpectedly succeeded' THEN RAISE; END IF;
  END;

  INSERT INTO tanaghom.external_operations (
    correlation_id, provider, operation_type, idempotency_key, request_fingerprint
  ) VALUES (correlation, 'postiz', 'publish', 'fixture-post-1', 'sha256:fixture');

  BEGIN
    INSERT INTO tanaghom.external_operations (
      correlation_id, provider, operation_type, idempotency_key, request_fingerprint
    ) VALUES (gen_random_uuid(), 'postiz', 'publish', 'fixture-post-1', 'sha256:fixture');
    RAISE EXCEPTION 'duplicate idempotency key unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO tanaghom.api_idempotency_keys (
    actor_user_id, operation_type, idempotency_key, request_hash
  ) VALUES (
    '00000000-0000-4000-8000-000000000001', 'content.decision',
    'fixture-decision-1',
    'sha256:0000000000000000000000000000000000000000000000000000000000000000'
  );

  BEGIN
    INSERT INTO tanaghom.api_idempotency_keys (
      actor_user_id, operation_type, idempotency_key, request_hash
    ) VALUES (
      '00000000-0000-4000-8000-000000000001', 'content.decision',
      'fixture-decision-1',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111'
    );
    RAISE EXCEPTION 'duplicate API idempotency key unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

SELECT 'PASS: Phase 1 database invariants enforced.' AS result;
