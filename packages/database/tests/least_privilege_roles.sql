\set ON_ERROR_STOP on

DO $$
DECLARE
  strategy_id uuid;
  content_id uuid;
BEGIN
  SELECT id INTO strategy_id
  FROM tanaghom.campaign_strategies
  WHERE campaign_id = '20000000-0000-4000-8000-000000000001'
  ORDER BY version DESC
  LIMIT 1;

  IF strategy_id IS NULL THEN
    INSERT INTO tanaghom.campaign_strategies (
      campaign_id, version, positioning, key_messages, channels,
      posting_cadence, content_pillars, model_name, prompt_version
    ) VALUES (
      '20000000-0000-4000-8000-000000000001', 99, 'Role boundary fixture',
      '["safe"]', '["instagram"]', '{"instagram":"weekly"}', '["growth"]',
      'fixture-model', 'role-test-v1'
    ) RETURNING id INTO strategy_id;
  END IF;

  INSERT INTO tanaghom.content_items (
    campaign_id, strategy_id, channel, content_type, draft_copy, media_brief,
    status
  ) VALUES (
    '20000000-0000-4000-8000-000000000001', strategy_id, 'instagram',
    'post', 'Role boundary draft', 'Role boundary visual', 'pending_approval'
  ) RETURNING id INTO content_id;

  PERFORM set_config('tanaghom.role_test_content_id', content_id::text, false);
END;
$$;

SET ROLE tanaghom_n8n_worker;

SELECT count(*) FROM tanaghom.agent_jobs;
SELECT count(*) FROM tanaghom.campaigns;

DO $$
BEGIN
  BEGIN
    INSERT INTO tanaghom.content_approvals (content_item_id, decision, decided_by)
    VALUES (
      current_setting('tanaghom.role_test_content_id')::uuid,
      'approved',
      '00000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'n8n approval insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE tanaghom.content_items
    SET status = 'approved'
    WHERE id = current_setting('tanaghom.role_test_content_id')::uuid;
    RAISE EXCEPTION 'n8n content update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO tanaghom.campaign_strategies (
      campaign_id, version, positioning, key_messages, channels,
      posting_cadence, content_pillars, model_name, prompt_version
    ) VALUES (
      '20000000-0000-4000-8000-000000000001', 100, 'Forbidden',
      '[]', '[]', '{}', '[]', 'forbidden', 'forbidden'
    );
    RAISE EXCEPTION 'n8n direct strategy insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM count(*) FROM tanaghom.content_approvals;
    RAISE EXCEPTION 'n8n approval read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

RESET ROLE;

SET ROLE tanaghom_api;

DO $$
DECLARE
  content_id uuid := current_setting('tanaghom.role_test_content_id')::uuid;
BEGIN
  INSERT INTO tanaghom.api_idempotency_keys (
    actor_user_id, operation_type, idempotency_key, request_hash
  ) VALUES (
    '00000000-0000-4000-8000-000000000001', 'content.decision',
    'role-boundary-decision',
    'sha256:2222222222222222222222222222222222222222222222222222222222222222'
  );

  INSERT INTO tanaghom.content_approvals (content_item_id, decision, decided_by)
  VALUES (content_id, 'approved', '00000000-0000-4000-8000-000000000001');

  UPDATE tanaghom.content_items SET status = 'approved' WHERE id = content_id;

  INSERT INTO tanaghom.agent_actions_log (
    correlation_id, actor_user_id, action_type, entity_type, entity_id, result
  ) VALUES (
    '40000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000001',
    'content.approved', 'content_item', content_id, 'success'
  );

  INSERT INTO tanaghom.outbox_events (
    correlation_id, event_key, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    '40000000-0000-4000-8000-000000000004',
    'role-boundary-content-approved', 'content.approved',
    'content_item', content_id, jsonb_build_object('content_item_id', content_id)
  );
END;
$$;

RESET ROLE;

SET ROLE tanaghom_readonly;

SELECT count(*) FROM tanaghom.campaigns;

DO $$
BEGIN
  BEGIN
    INSERT INTO tanaghom.notifications (severity, title, body)
    VALUES ('info', 'Forbidden', 'Readonly role must not write');
    RAISE EXCEPTION 'readonly insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_namespace namespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
    ) privilege
    WHERE namespace.nspname = 'tanaghom'
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'USAGE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC unexpectedly retains tanaghom schema usage';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
    ) privilege
    WHERE namespace.nspname = 'tanaghom'
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC unexpectedly retains tanaghom function execution';
  END IF;
  IF has_table_privilege('tanaghom_n8n_worker', 'tanaghom.content_approvals', 'SELECT') THEN
    RAISE EXCEPTION 'n8n unexpectedly has approval read access';
  END IF;
  IF has_table_privilege('tanaghom_n8n_worker', 'tanaghom.content_approvals', 'INSERT') THEN
    RAISE EXCEPTION 'n8n unexpectedly has approval insert access';
  END IF;
  IF has_table_privilege('tanaghom_n8n_worker', 'tanaghom.content_items', 'UPDATE') THEN
    RAISE EXCEPTION 'n8n unexpectedly has direct content update access';
  END IF;
  IF NOT has_table_privilege('tanaghom_api', 'tanaghom.content_approvals', 'INSERT') THEN
    RAISE EXCEPTION 'API approval insert privilege is missing';
  END IF;
  IF NOT has_table_privilege('tanaghom_readonly', 'tanaghom.campaigns', 'SELECT') THEN
    RAISE EXCEPTION 'readonly campaign select privilege is missing';
  END IF;
END;
$$;

SELECT 'PASS: least-privilege role boundaries enforced.' AS result;
