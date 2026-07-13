\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT postiz_draft_mode FROM tanaghom.postiz_automation_status
      WHERE organization_id = '10000000-0000-4000-8000-000000000001') <> 'manual' THEN
    RAISE EXCEPTION 'automation policy did not default to manual';
  END IF;
  IF NOT (SELECT emergency_stop FROM tanaghom.postiz_automation_status
          WHERE organization_id = '10000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'platform emergency stop did not default to active';
  END IF;
  IF has_table_privilege('tanaghom_api', 'tanaghom.automation_platform_controls', 'SELECT,UPDATE')
     OR has_table_privilege('tanaghom_n8n_worker', 'tanaghom.organization_automation_policies', 'SELECT,UPDATE') THEN
    RAISE EXCEPTION 'automation control tables are directly accessible';
  END IF;
  IF NOT has_function_privilege('tanaghom_api', 'tanaghom.set_postiz_automation_mode(uuid,text,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('tanaghom_n8n_worker', 'tanaghom.claim_postiz_draft_job()', 'EXECUTE') THEN
    RAISE EXCEPTION 'controlled automation function grants are missing';
  END IF;
END;
$$;

UPDATE tanaghom.integration_connections
SET status = 'connected', credential_ciphertext = decode('01', 'hex'),
    credential_nonce = decode(repeat('02', 12), 'hex'),
    credential_auth_tag = decode(repeat('03', 16), 'hex'),
    credential_key_version = 1, secret_last_four = 'test', disconnected_at = NULL
WHERE provider = 'postiz';

SET ROLE tanaghom_api;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM tanaghom.set_postiz_automation_mode(
      '00000000-0000-4000-8000-000000000001', 'automatic', true
    );
    RAISE EXCEPTION 'customer bypassed platform emergency stop';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'customer bypassed platform emergency stop' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

UPDATE tanaghom.automation_platform_controls
SET emergency_stop = false, reason = 'Disposable automation control test'
WHERE provider = 'postiz';

SET ROLE tanaghom_api;
SELECT * FROM tanaghom.set_postiz_automation_mode(
  '00000000-0000-4000-8000-000000000001', 'automatic', true
);
RESET ROLE;

DO $$
DECLARE
  v_strategy_id uuid;
BEGIN
  SELECT id INTO v_strategy_id FROM tanaghom.campaign_strategies
  WHERE campaign_id = '20000000-0000-4000-8000-000000000001'
  ORDER BY version DESC LIMIT 1;
  INSERT INTO tanaghom.content_items (
    id, campaign_id, strategy_id, generation, channel, content_type,
    draft_copy, media_brief, status
  ) VALUES (
    '52000000-0000-4000-8000-000000000009',
    '20000000-0000-4000-8000-000000000001', v_strategy_id, 209,
    'instagram', 'post', 'Automatic draft fixture', 'No external media',
    'pending_approval'
  );
  INSERT INTO tanaghom.content_approvals (content_item_id, decision, decided_by)
  VALUES (
    '52000000-0000-4000-8000-000000000009', 'approved',
    '00000000-0000-4000-8000-000000000001'
  );
  UPDATE tanaghom.content_items SET status = 'approved'
  WHERE id = '52000000-0000-4000-8000-000000000009';
END;
$$;

SET ROLE tanaghom_api;
DO $$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM tanaghom.maybe_queue_automatic_postiz_draft(
    '52000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000001', true
  );
  IF NOT v_result.queued OR v_result.job_id IS NULL THEN
    RAISE EXCEPTION 'automatic mode did not queue approved content';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE tanaghom_api;
SELECT * FROM tanaghom.set_postiz_automation_mode(
  '00000000-0000-4000-8000-000000000001', 'paused', true
);
RESET ROLE;

SET ROLE tanaghom_n8n_worker;
DO $$
DECLARE v_claim record;
BEGIN
  SELECT * INTO v_claim FROM tanaghom.claim_postiz_draft_job();
  IF v_claim.job_id IS NOT NULL THEN RAISE EXCEPTION 'paused automation allowed a worker claim'; END IF;
END;
$$;
RESET ROLE;

SET ROLE tanaghom_api;
SELECT * FROM tanaghom.set_postiz_automation_mode(
  '00000000-0000-4000-8000-000000000001', 'automatic', true
);
RESET ROLE;

SET ROLE tanaghom_n8n_worker;
DO $$
DECLARE v_claim record;
BEGIN
  SELECT * INTO v_claim FROM tanaghom.claim_postiz_draft_job();
  IF v_claim.job_id IS NULL THEN RAISE EXCEPTION 'ready automatic job was not claimed'; END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.agent_actions_log
    WHERE action_type = 'postiz.automation_mode_changed'
      AND payload->>'previous_mode' = 'manual'
      AND payload->>'new_mode' = 'automatic'
  ) THEN RAISE EXCEPTION 'automation mode audit evidence missing'; END IF;
END;
$$;

UPDATE tanaghom.agent_jobs
SET status = 'cancelled', finished_at = statement_timestamp()
WHERE job_type = 'content.postiz.draft'
  AND input->>'content_item_id' = '52000000-0000-4000-8000-000000000009'
  AND status = 'running';
UPDATE tanaghom.organization_automation_policies
SET postiz_draft_mode = 'manual'
WHERE organization_id = '10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.integration_connections
SET status = 'disconnected', credential_ciphertext = NULL,
    credential_nonce = NULL, credential_auth_tag = NULL,
    credential_key_version = NULL, secret_last_four = NULL,
    disconnected_at = statement_timestamp()
WHERE provider = 'postiz';
UPDATE tanaghom.automation_platform_controls
SET emergency_stop = true, reason = 'Disposable automation test complete'
WHERE provider = 'postiz';

SELECT 'PASS: customer automation modes and platform safety gates enforced.' AS result;
