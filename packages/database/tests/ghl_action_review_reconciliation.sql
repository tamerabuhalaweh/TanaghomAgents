\set ON_ERROR_STOP on

UPDATE tanaghom.automation_platform_controls SET emergency_stop=false,
  reason='Disposable GHL action review test' WHERE provider='ghl';
INSERT INTO tanaghom.integration_connections (
  organization_id,provider,status,base_url,credential_kind,credential_ciphertext,
  credential_nonce,credential_auth_tag,credential_key_version,secret_last_four,
  configuration,configured_by,last_tested_at,last_test_status
) VALUES (
  '10000000-0000-4000-8000-000000000001','ghl','connected',
  'https://services.leadconnectorhq.com','private_token',decode('01','hex'),
  decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test',
  '{"location_id":"location-test-1"}','00000000-0000-4000-8000-000000000001',now(),'passed'
)
ON CONFLICT (organization_id,provider) DO UPDATE SET
  status='connected',base_url=EXCLUDED.base_url,credential_kind=EXCLUDED.credential_kind,
  credential_ciphertext=EXCLUDED.credential_ciphertext,credential_nonce=EXCLUDED.credential_nonce,
  credential_auth_tag=EXCLUDED.credential_auth_tag,credential_key_version=EXCLUDED.credential_key_version,
  secret_last_four=EXCLUDED.secret_last_four,configuration=EXCLUDED.configuration,
  configured_by=EXCLUDED.configured_by,last_tested_at=now(),last_test_status='passed',
  last_error_code=NULL,disconnected_at=NULL;
SELECT tanaghom.set_ghl_action_emergency_stop(
  '00000000-0000-4000-8000-000000000001',false,'Disposable review runtime opened',true,
  '6a000000-0000-4000-8000-000000000001'
);
SELECT tanaghom.set_ghl_action_automation_mode(
  '00000000-0000-4000-8000-000000000001','assisted',true,
  '6a000000-0000-4000-8000-000000000002'
);

INSERT INTO tanaghom.app_users (id,email,display_name,kind,role,organization_id)
VALUES ('6a000000-0000-4000-8000-000000000009','sales-agent@example.test',
  'Disposable Sales Agent','service','service','10000000-0000-4000-8000-000000000001');
INSERT INTO tanaghom.leads (id,campaign_id,name,contact_phone,status)
VALUES ('6a000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000001',
  'Action Review Test Lead','+15555550200','new');
INSERT INTO tanaghom.conversations (
  id,organization_id,provider_conversation_id,contact_id,lead_id,state,reply_authority,
  ownership_epoch,ownership_reason,last_event_at,last_activity_at
) VALUES (
  '6a000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001',
  'action-review-conversation','action-review-contact','6a000000-0000-4000-8000-000000000010',
  'ai_owned','ai',1,'Disposable AI action review',now(),now()
);

DO $$
DECLARE v_job record; v_claim record; v_prepare record; v_status text;
BEGIN
  SELECT * INTO v_job FROM tanaghom.queue_ghl_action(
    '6a000000-0000-4000-8000-000000000011','appointment','internal','system',
    '{"calendar_id":"calendar-test","start_time":"2026-07-20T10:00:00Z","end_time":"2026-07-20T10:30:00Z","title":"Disposable consultation"}',
    NULL,NULL,NULL,1,NULL,'ghl-review:not-applied:1'
  );
  IF v_job.status<>'awaiting_approval' THEN RAISE EXCEPTION 'assisted appointment bypassed approval'; END IF;
  IF tanaghom.decide_ghl_action(v_job.job_id,'00000000-0000-4000-8000-000000000001',
      'approved','Disposable appointment approved','6a000000-0000-4000-8000-000000000020')<>'queued' THEN
    RAISE EXCEPTION 'approved GHL action was not queued';
  END IF;
  SELECT * INTO v_claim FROM tanaghom.claim_ghl_action_job();
  SELECT * INTO v_prepare FROM tanaghom.prepare_ghl_action_dispatch(v_claim.job_id);
  PERFORM tanaghom.record_ghl_action_failure(v_claim.job_id,'provider_timeout','Unknown provider result',0,300);
  v_status:=tanaghom.reconcile_ghl_action(v_claim.job_id,'00000000-0000-4000-8000-000000000001',
    'confirmed_not_applied','Verified in disposable provider audit',NULL,
    '6a000000-0000-4000-8000-000000000021');
  IF v_status<>'failed' OR (SELECT status FROM tanaghom.external_operations WHERE id=v_prepare.operation_id)<>'failed' THEN
    RAISE EXCEPTION 'not-applied reconciliation did not close both records';
  END IF;
  IF tanaghom.reconcile_ghl_action(v_claim.job_id,'00000000-0000-4000-8000-000000000001',
      'confirmed_not_applied','Verified in disposable provider audit',NULL,
      '6a000000-0000-4000-8000-000000000021')<>'failed' THEN
    RAISE EXCEPTION 'reconciliation command replay changed result';
  END IF;

  SELECT * INTO v_job FROM tanaghom.queue_ghl_action(
    '6a000000-0000-4000-8000-000000000011','appointment','internal','system',
    '{"calendar_id":"calendar-test","start_time":"2026-07-21T10:00:00Z","end_time":"2026-07-21T10:30:00Z","title":"Verified consultation"}',
    NULL,NULL,NULL,1,NULL,'ghl-review:succeeded:1'
  );
  PERFORM tanaghom.decide_ghl_action(v_job.job_id,'00000000-0000-4000-8000-000000000001',
    'approved','Second disposable appointment approved','6a000000-0000-4000-8000-000000000022');
  SELECT * INTO v_claim FROM tanaghom.claim_ghl_action_job();
  SELECT * INTO v_prepare FROM tanaghom.prepare_ghl_action_dispatch(v_claim.job_id);
  PERFORM tanaghom.record_ghl_action_failure(v_claim.job_id,'provider_timeout','Unknown provider result',408,300);
  v_status:=tanaghom.reconcile_ghl_action(v_claim.job_id,'00000000-0000-4000-8000-000000000001',
    'confirmed_succeeded','Verified appointment in disposable provider','appointment-confirmed-1',
    '6a000000-0000-4000-8000-000000000023');
  IF v_status<>'succeeded'
     OR (SELECT provider_reference FROM tanaghom.ghl_action_jobs WHERE id=v_claim.job_id)<>'appointment-confirmed-1'
     OR (SELECT status FROM tanaghom.external_operations WHERE id=v_prepare.operation_id)<>'succeeded' THEN
    RAISE EXCEPTION 'successful reconciliation evidence is incomplete';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tanaghom.agent_actions_log audit
    WHERE audit.action_type='ghl.action_queued'
      AND audit.entity_id='6a000000-0000-4000-8000-000000000011'
      AND audit.actor_user_id IS NULL
  ) THEN RAISE EXCEPTION 'service GHL action audit lost its actor'; END IF;
  BEGIN
    UPDATE tanaghom.ghl_action_reconciliations SET reason='Mutated evidence'
    WHERE action_job_id IN (
      SELECT id FROM tanaghom.ghl_action_jobs
      WHERE conversation_id='6a000000-0000-4000-8000-000000000011'
    );
    RAISE EXCEPTION 'reconciliation update bypassed append-only trigger';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='reconciliation update bypassed append-only trigger' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM tanaghom.ghl_action_reconciliations
    WHERE action_job_id IN (
      SELECT id FROM tanaghom.ghl_action_jobs
      WHERE conversation_id='6a000000-0000-4000-8000-000000000011'
    );
    RAISE EXCEPTION 'reconciliation delete bypassed append-only trigger';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='reconciliation delete bypassed append-only trigger' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege('tanaghom_n8n_worker','tanaghom.ghl_action_reconciliations','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_conversation_worker','tanaghom.ghl_action_reconciliations','SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_function_privilege('tanaghom_api',
       'tanaghom.reconcile_ghl_action(uuid,uuid,text,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'GHL reconciliation least-privilege boundary failed';
  END IF;
END;
$$;

ALTER TABLE tanaghom.ghl_action_reconciliations DISABLE TRIGGER ghl_action_reconciliation_no_delete;
DELETE FROM tanaghom.ghl_action_reconciliations
WHERE action_job_id IN (SELECT id FROM tanaghom.ghl_action_jobs WHERE conversation_id='6a000000-0000-4000-8000-000000000011');
ALTER TABLE tanaghom.ghl_action_reconciliations ENABLE TRIGGER ghl_action_reconciliation_no_delete;
ALTER TABLE tanaghom.ghl_action_outcomes DISABLE TRIGGER ghl_action_outcome_no_delete;
DELETE FROM tanaghom.ghl_action_jobs WHERE conversation_id='6a000000-0000-4000-8000-000000000011';
ALTER TABLE tanaghom.ghl_action_outcomes ENABLE TRIGGER ghl_action_outcome_no_delete;
DELETE FROM tanaghom.external_operations WHERE provider='ghl' AND idempotency_key LIKE 'ghl-review:%';
DELETE FROM tanaghom.conversations WHERE id='6a000000-0000-4000-8000-000000000011';
DELETE FROM tanaghom.leads WHERE id='6a000000-0000-4000-8000-000000000010';
UPDATE tanaghom.integration_connections SET status='disconnected',credential_ciphertext=NULL,
  credential_nonce=NULL,credential_auth_tag=NULL,credential_key_version=NULL,secret_last_four=NULL,
  configuration='{}'::jsonb,last_tested_at=NULL,last_test_status=NULL,last_error_code=NULL,disconnected_at=now()
WHERE organization_id='10000000-0000-4000-8000-000000000001' AND provider='ghl';
UPDATE tanaghom.organization_crm_policies SET action_mode='manual',action_emergency_stop=true,
  action_emergency_reason='Disposable GHL action review test complete'
WHERE organization_id='10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,
  reason='Disposable GHL action review test complete' WHERE provider='ghl';

SELECT 'PASS: GHL action approval and idempotent human reconciliation are tenant-bound and least-privileged.' AS result;
