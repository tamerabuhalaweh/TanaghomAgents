\set ON_ERROR_STOP on

UPDATE tanaghom.automation_platform_controls
SET emergency_stop = false, reason = 'Disposable GHL contact test'
WHERE provider = 'ghl';

INSERT INTO tanaghom.integration_connections (
  organization_id, provider, status, base_url, credential_kind,
  credential_ciphertext, credential_nonce, credential_auth_tag,
  credential_key_version, secret_last_four, configuration, configured_by
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'ghl', 'connected',
  'https://services.leadconnectorhq.com', 'private_token', decode('01', 'hex'),
  decode(repeat('02', 12), 'hex'), decode(repeat('03', 16), 'hex'),
  1, 'test', '{"location_id":"location-test-1"}',
  '00000000-0000-4000-8000-000000000001'
);

INSERT INTO tanaghom.leads (
  id, campaign_id, name, contact_email, contact_phone, status
) VALUES (
  '65000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'GHL Disposable Lead', 'lead@example.test', '+15555550100', 'new'
);

INSERT INTO tanaghom.organizations (id, slug, name)
VALUES ('65000000-0000-4000-8000-000000000020', 'ghl-boundary-test', 'GHL Boundary Test');
INSERT INTO tanaghom.app_users (
  id, email, display_name, kind, role, organization_id, auth_subject, accepted_at
) VALUES (
  '65000000-0000-4000-8000-000000000021', 'other-owner@example.test',
  'Other Owner', 'human', 'owner', '65000000-0000-4000-8000-000000000020',
  '65000000-0000-4000-8000-000000000024', now()
);
INSERT INTO tanaghom.campaigns (
  id, name, brief, product_type, target_audience, organization_id, created_by
) VALUES (
  '65000000-0000-4000-8000-000000000022', 'Other CRM Campaign',
  'Cross-organization boundary fixture.', 'course', '{}',
  '65000000-0000-4000-8000-000000000020',
  '65000000-0000-4000-8000-000000000021'
);
INSERT INTO tanaghom.leads (id, campaign_id, name, contact_email)
VALUES (
  '65000000-0000-4000-8000-000000000023',
  '65000000-0000-4000-8000-000000000022',
  'Other Organization Lead', 'other-lead@example.test'
);

SET ROLE tanaghom_api;
DO $$
DECLARE v_first record; v_replay record;
BEGIN
  SELECT * INTO v_first FROM tanaghom.queue_ghl_contact_upsert(
    '65000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  );
  SELECT * INTO v_replay FROM tanaghom.queue_ghl_contact_upsert(
    '65000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  );
  IF v_first.job_id IS NULL OR v_first.job_id <> v_replay.job_id
     OR v_first.job_status <> 'queued' THEN
    RAISE EXCEPTION 'GHL contact queue was not idempotent while active';
  END IF;
  BEGIN
    PERFORM * FROM tanaghom.prepare_ghl_contact_upsert(v_first.job_id);
    RAISE EXCEPTION 'API unexpectedly prepared a GHL request';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM tanaghom.queue_ghl_contact_upsert(
      '65000000-0000-4000-8000-000000000023',
      '00000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-organization lead unexpectedly queued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-organization lead unexpectedly queued' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

SET ROLE tanaghom_n8n_worker;
DO $$
DECLARE v_claim record; v_prepared record; v_retry record; v_contact text;
BEGIN
  SELECT * INTO v_claim FROM tanaghom.claim_ghl_contact_job();
  IF v_claim.job_id IS NULL THEN RAISE EXCEPTION 'GHL job was not claimed'; END IF;
  SELECT * INTO v_prepared FROM tanaghom.prepare_ghl_contact_upsert(v_claim.job_id);
  IF v_prepared.request_body->>'locationId' <> 'location-test-1'
     OR v_prepared.request_body->>'source' <> 'Tanaghom'
     OR (v_prepared.request_body->>'createNewIfDuplicateAllowed')::boolean THEN
    RAISE EXCEPTION 'prepared GHL request violated the contact-only contract';
  END IF;
  IF tanaghom.record_ghl_contact_failure(
    v_claim.job_id, 'ghl_rate_limited', 'simulated rate limit', 429, 0
  ) <> 'queued' THEN RAISE EXCEPTION 'retryable GHL failure was not requeued'; END IF;
  SELECT * INTO v_retry FROM tanaghom.claim_ghl_contact_job();
  SELECT * INTO v_prepared FROM tanaghom.prepare_ghl_contact_upsert(v_retry.job_id);
  IF v_retry.job_id <> v_claim.job_id THEN RAISE EXCEPTION 'retry created a second job'; END IF;
  SELECT tanaghom.complete_ghl_contact_upsert(
    v_retry.job_id,
    '{"contract_version":"phase5.ghl-contact-upsert-result.v1","provider_contact_id":"ghl-contact-test-1","location_id":"location-test-1","created":true}'
  ) INTO v_contact;
  IF v_contact <> 'ghl-contact-test-1' THEN RAISE EXCEPTION 'GHL completion returned the wrong contact'; END IF;
END;
$$;
RESET ROLE;

UPDATE tanaghom.organization_crm_policies SET contact_sync_mode='paused'
WHERE organization_id='10000000-0000-4000-8000-000000000001';
SET ROLE tanaghom_api;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM tanaghom.queue_ghl_contact_upsert(
      '65000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'paused policy unexpectedly queued a GHL job';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'paused policy unexpectedly queued a GHL job' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
UPDATE tanaghom.organization_crm_policies SET contact_sync_mode='manual'
WHERE organization_id='10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,
  reason='Disposable emergency-stop assertion' WHERE provider='ghl';
SET ROLE tanaghom_api;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM tanaghom.queue_ghl_contact_upsert(
      '65000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'emergency stop unexpectedly queued a GHL job';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'emergency stop unexpectedly queued a GHL job' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT ghl_contact_id FROM tanaghom.leads WHERE id='65000000-0000-4000-8000-000000000001') <> 'ghl-contact-test-1' THEN
    RAISE EXCEPTION 'lead did not receive the provider contact ID';
  END IF;
  IF (SELECT status FROM tanaghom.ghl_contact_sync_state WHERE lead_id='65000000-0000-4000-8000-000000000001') <> 'succeeded' THEN
    RAISE EXCEPTION 'GHL sync state did not succeed';
  END IF;
  IF (SELECT count(*) FROM tanaghom.external_operations WHERE provider='ghl' AND operation_type='upsert_contact') <> 1 THEN
    RAISE EXCEPTION 'retry did not reuse one external operation';
  END IF;
  IF has_table_privilege('tanaghom_n8n_worker', 'tanaghom.leads', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_n8n_worker', 'tanaghom.ghl_contact_sync_state', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_n8n_worker', 'tanaghom.integration_connections', 'SELECT') THEN
    RAISE EXCEPTION 'worker gained direct application or credential access';
  END IF;
  IF NOT has_function_privilege('tanaghom_api', 'tanaghom.queue_ghl_contact_upsert(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('tanaghom_api', 'tanaghom.prepare_ghl_contact_upsert(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GHL API/worker function boundary is incorrect';
  END IF;
  IF has_table_privilege('tanaghom_n8n_worker', 'tanaghom.content_approvals', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'worker gained human approval access';
  END IF;
END;
$$;

UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,
  reason='Disposable GHL contact test complete' WHERE provider='ghl';
DELETE FROM tanaghom.integration_connections WHERE provider='ghl';
DELETE FROM tanaghom.leads WHERE id='65000000-0000-4000-8000-000000000023';
DELETE FROM tanaghom.campaigns WHERE id='65000000-0000-4000-8000-000000000022';
DELETE FROM tanaghom.app_users WHERE id='65000000-0000-4000-8000-000000000021';
DELETE FROM tanaghom.organizations WHERE id='65000000-0000-4000-8000-000000000020';

SELECT 'PASS: GHL contact sync is contact-only, replay-safe, and least-privileged.' AS result;
