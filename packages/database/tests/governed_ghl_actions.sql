\set ON_ERROR_STOP on

UPDATE tanaghom.automation_platform_controls SET emergency_stop=false,
  reason='Disposable governed GHL action test' WHERE provider='ghl';

INSERT INTO tanaghom.integration_connections (
  organization_id,provider,status,base_url,credential_kind,credential_ciphertext,
  credential_nonce,credential_auth_tag,credential_key_version,secret_last_four,
  configuration,configured_by
) VALUES (
  '10000000-0000-4000-8000-000000000001','ghl','connected',
  'https://services.leadconnectorhq.com','private_token',decode('01','hex'),
  decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test',
  '{"location_id":"location-test-1"}','00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (organization_id,provider) DO UPDATE SET
  status='connected',base_url=EXCLUDED.base_url,credential_kind=EXCLUDED.credential_kind,
  credential_ciphertext=EXCLUDED.credential_ciphertext,credential_nonce=EXCLUDED.credential_nonce,
  credential_auth_tag=EXCLUDED.credential_auth_tag,credential_key_version=EXCLUDED.credential_key_version,
  secret_last_four=EXCLUDED.secret_last_four,configuration=EXCLUDED.configuration,
  configured_by=EXCLUDED.configured_by,last_tested_at=now(),last_test_status='passed',
  last_error_code=NULL,disconnected_at=NULL;

SELECT tanaghom.set_ghl_action_emergency_stop(
  '00000000-0000-4000-8000-000000000001',false,
  'Disposable runtime gate opened',true,'69000000-0000-4000-8000-000000000001'
);

DO $$
BEGIN
  BEGIN
    PERFORM tanaghom.set_ghl_action_automation_mode(
      '00000000-0000-4000-8000-000000000001','assisted',false,
      '69000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'non-manual mode bypassed runtime readiness';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='non-manual mode bypassed runtime readiness' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE tanaghom.organization_crm_policies SET
  action_mode='manual',proactive_message_mode='approved_templates',
  action_allowed_channels=ARRAY['whatsapp'],
  action_quiet_hours_start=((statement_timestamp() AT TIME ZONE 'UTC')+interval '1 hour')::time,
  action_quiet_hours_end=((statement_timestamp() AT TIME ZONE 'UTC')+interval '2 hours')::time,
  action_timezone='UTC',action_contact_frequency_cap_24h=2
WHERE organization_id='10000000-0000-4000-8000-000000000001';

INSERT INTO tanaghom.leads (id,campaign_id,name,contact_phone,status)
VALUES ('69000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000001',
  'Governed Action Test Lead','+15555550199','new');

INSERT INTO tanaghom.conversations (
  id,organization_id,provider_conversation_id,contact_id,lead_id,state,reply_authority,
  assigned_user_id,owner_user_id,ownership_epoch,ownership_reason,last_event_at,last_activity_at
) VALUES (
  '69000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001',
  'governed-action-conversation','governed-action-contact','69000000-0000-4000-8000-000000000010',
  'human_owned','human','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',1,'Disposable human-owned conversation',now(),now()
);

INSERT INTO tanaghom.ghl_message_template_versions (
  id,organization_id,template_key,version,channel,purpose,language,body,status,
  created_by,approved_by,approved_at
) VALUES (
  '69000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001',
  'approved-disposable-follow-up',1,'whatsapp','proactive','en','Approved bounded test message',
  'approved','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',now()
);

INSERT INTO tanaghom.ghl_contact_channel_policies (
  organization_id,contact_id,channel,consent_status,evidence,changed_by
) VALUES (
  '10000000-0000-4000-8000-000000000001','governed-action-contact','whatsapp',
  'opted_in','Explicit disposable test consent','00000000-0000-4000-8000-000000000001'
);

DO $$
DECLARE v_first record; v_replay record; v_second record; v_claim record; v_prepared record;
BEGIN
  SELECT * INTO v_first FROM tanaghom.queue_ghl_action(
    '69000000-0000-4000-8000-000000000011','message','proactive','whatsapp',
    '{"message":"Approved bounded test message"}',
    '69000000-0000-4000-8000-000000000012',NULL,
    '00000000-0000-4000-8000-000000000001',1,NULL,'ghl-action:disposable:1'
  );
  SELECT * INTO v_replay FROM tanaghom.queue_ghl_action(
    '69000000-0000-4000-8000-000000000011','message','proactive','whatsapp',
    '{"message":"Approved bounded test message"}',
    '69000000-0000-4000-8000-000000000012',NULL,
    '00000000-0000-4000-8000-000000000001',1,NULL,'ghl-action:disposable:1'
  );
  IF v_first.job_id<>v_replay.job_id OR NOT v_replay.replayed OR v_first.status<>'queued' THEN
    RAISE EXCEPTION 'GHL action queue is not replay-safe';
  END IF;
  SELECT * INTO v_claim FROM tanaghom.claim_ghl_action_job();
  IF v_claim.job_id<>v_first.job_id OR v_claim.attempt<>1 THEN RAISE EXCEPTION 'wrong GHL action claimed'; END IF;
  SELECT * INTO v_prepared FROM tanaghom.prepare_ghl_action_dispatch(v_first.job_id);
  IF v_prepared.operation_id IS NULL OR v_prepared.request_body->>'contract_version'<>'phase5.ghl-action-dispatch.v1'
     OR v_prepared.request_body->>'action_type'<>'message' THEN
    RAISE EXCEPTION 'GHL action dispatch contract was not prepared';
  END IF;

  SELECT * INTO v_second FROM tanaghom.queue_ghl_action(
    '69000000-0000-4000-8000-000000000011','message','proactive','whatsapp',
    '{"message":"Approved bounded test message"}',
    '69000000-0000-4000-8000-000000000012',NULL,
    '00000000-0000-4000-8000-000000000001',1,NULL,'ghl-action:disposable:2'
  );
  UPDATE tanaghom.ghl_contact_channel_policies SET consent_status='opted_out',
    evidence='Disposable opt-out event' WHERE organization_id='10000000-0000-4000-8000-000000000001'
      AND contact_id='governed-action-contact' AND channel='whatsapp';
  IF (SELECT status FROM tanaghom.ghl_action_jobs WHERE id=v_second.job_id)<>'canceled' THEN
    RAISE EXCEPTION 'opt-out did not cancel safely queued action';
  END IF;
  IF tanaghom.record_ghl_action_failure(v_first.job_id,'provider_timeout',
      'Provider outcome is unknown after dispatch',0,300)<>'indeterminate' THEN
    RAISE EXCEPTION 'provider timeout did not become indeterminate';
  END IF;
  IF EXISTS (SELECT 1 FROM tanaghom.claim_ghl_action_job()) THEN
    RAISE EXCEPTION 'worker claimed action while an indeterminate operation exists';
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege('tanaghom_n8n_worker','tanaghom.ghl_action_jobs','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_n8n_worker','tanaghom.ghl_action_approvals','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_conversation_worker','tanaghom.ghl_action_jobs','SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_function_privilege('tanaghom_n8n_worker','tanaghom.claim_ghl_action_job()','EXECUTE')
     OR NOT has_function_privilege('tanaghom_conversation_worker',
       'tanaghom.queue_ghl_action(uuid,text,text,text,jsonb,uuid,uuid,uuid,bigint,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'governed GHL action least-privilege boundary failed';
  END IF;
  BEGIN
    UPDATE tanaghom.ghl_action_outcomes SET details='{}'::jsonb
      WHERE id=(SELECT id FROM tanaghom.ghl_action_outcomes LIMIT 1);
    RAISE EXCEPTION 'append-only GHL action outcome was mutated';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='append-only GHL action outcome was mutated' THEN RAISE; END IF;
  END;
END;
$$;

DELETE FROM tanaghom.notifications
WHERE entity_type='ghl_action_job'
  AND entity_id IN (
    SELECT id FROM tanaghom.ghl_action_jobs
    WHERE conversation_id='69000000-0000-4000-8000-000000000011'
  );
ALTER TABLE tanaghom.ghl_action_outcomes DISABLE TRIGGER ghl_action_outcome_no_delete;
ALTER TABLE tanaghom.ghl_action_outcomes DISABLE TRIGGER ghl_action_outcome_no_update;
DELETE FROM tanaghom.ghl_action_jobs
WHERE conversation_id='69000000-0000-4000-8000-000000000011';
ALTER TABLE tanaghom.ghl_action_outcomes ENABLE TRIGGER ghl_action_outcome_no_delete;
ALTER TABLE tanaghom.ghl_action_outcomes ENABLE TRIGGER ghl_action_outcome_no_update;
DELETE FROM tanaghom.external_operations
WHERE provider='ghl' AND idempotency_key LIKE 'ghl-action:disposable:%';
DELETE FROM tanaghom.ghl_contact_channel_policies
WHERE organization_id='10000000-0000-4000-8000-000000000001'
  AND contact_id='governed-action-contact';
DELETE FROM tanaghom.ghl_message_template_versions
WHERE id='69000000-0000-4000-8000-000000000012';
DELETE FROM tanaghom.conversations
WHERE id='69000000-0000-4000-8000-000000000011';
DELETE FROM tanaghom.leads
WHERE id='69000000-0000-4000-8000-000000000010';
UPDATE tanaghom.integration_connections SET
  status='disconnected',credential_ciphertext=NULL,credential_nonce=NULL,
  credential_auth_tag=NULL,credential_key_version=NULL,secret_last_four=NULL,
  configuration='{}'::jsonb,last_tested_at=NULL,last_test_status=NULL,
  last_error_code=NULL,disconnected_at=now()
WHERE organization_id='10000000-0000-4000-8000-000000000001' AND provider='ghl';
UPDATE tanaghom.organization_crm_policies SET
  action_mode='manual',proactive_message_mode='disabled',action_emergency_stop=true,
  action_emergency_reason='Disposable governed GHL action test complete',
  action_allowed_channels='{}'::text[],action_quiet_hours_start=time '21:00',
  action_quiet_hours_end=time '08:00',action_timezone='UTC',action_contact_frequency_cap_24h=2
WHERE organization_id='10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,
  reason='Disposable governed GHL action test complete' WHERE provider='ghl';

SELECT 'PASS: GHL actions are consent-aware, replay-safe, takeover-safe, indeterminate-safe, and least-privileged.' AS result;
