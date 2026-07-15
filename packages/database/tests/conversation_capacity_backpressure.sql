\set ON_ERROR_STOP on

INSERT INTO tanaghom.integration_connections (
  organization_id,provider,status,base_url,credential_kind,credential_ciphertext,
  credential_nonce,credential_auth_tag,credential_key_version,secret_last_four,
  configuration,configured_by
) VALUES (
  '10000000-0000-4000-8000-000000000001','ghl','connected',
  'https://services.leadconnectorhq.com','private_token',decode('01','hex'),
  decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test',
  '{"location_id":"location-capacity-test"}'::jsonb,'00000000-0000-4000-8000-000000000001'
) ON CONFLICT (organization_id,provider) DO UPDATE SET
  status='connected',base_url=EXCLUDED.base_url,credential_kind=EXCLUDED.credential_kind,
  credential_ciphertext=EXCLUDED.credential_ciphertext,credential_nonce=EXCLUDED.credential_nonce,
  credential_auth_tag=EXCLUDED.credential_auth_tag,credential_key_version=EXCLUDED.credential_key_version,
  secret_last_four=EXCLUDED.secret_last_four,configuration=EXCLUDED.configuration,disconnected_at=NULL;

UPDATE tanaghom.organization_crm_policies SET conversation_processing_mode='shadow'
WHERE organization_id='10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.automation_platform_controls SET emergency_stop=false,reason='Disposable capacity test'
WHERE provider='ghl';

SET ROLE tanaghom_api;
SELECT (tanaghom.set_conversation_capacity_policy(
  '10000000-0000-4000-8000-000000000001',1,1000,1,1000,1,10,
  '00000000-0000-4000-8000-000000000001'
)).organization_id;
DO $$
BEGIN
  BEGIN
    PERFORM tanaghom.set_conversation_capacity_policy(
      '10000000-0000-4000-8000-000000000001',2,1000,1,1000,1,10,
      '00000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'non-owner changed the capacity policy';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='non-owner changed the capacity policy' THEN RAISE; END IF;
  END;
END;
$$;

SELECT * FROM tanaghom.accept_ghl_inbound_event(
  '{"contract_version":"phase5.ghl-inbound-event.v1","provider_event_id":"capacity-background-1","provider_event_type":"ContactUpdate","location_id":"location-capacity-test","contact_id":"capacity-contact-1","conversation_id":"capacity-conversation-1","channel":"whatsapp","direction":"system","occurred_at":"2026-07-15T10:00:00Z","details":{}}'::jsonb,
  repeat('1',64)
);
SELECT * FROM tanaghom.accept_ghl_inbound_event(
  '{"contract_version":"phase5.ghl-inbound-event.v1","provider_event_id":"capacity-interactive-1","provider_event_type":"InboundMessage","location_id":"location-capacity-test","contact_id":"capacity-contact-2","conversation_id":"capacity-conversation-2","message_id":"capacity-message-1","channel":"whatsapp","direction":"inbound","occurred_at":"2026-07-15T10:00:01Z","details":{"body":"Capacity test"}}'::jsonb,
  repeat('2',64)
);
RESET ROLE;

SET ROLE tanaghom_conversation_worker;
SELECT * FROM tanaghom.claim_ghl_inbound_event_job() \gset capacity_first_
RESET ROLE;
DO $$
BEGIN
  IF (SELECT provider_event_id FROM tanaghom.ghl_inbound_events WHERE status='processing' LIMIT 1)
       <>'capacity-interactive-1' THEN
    RAISE EXCEPTION 'interactive work did not preempt background work';
  END IF;
END;
$$;
SET ROLE tanaghom_conversation_worker;
DO $$
DECLARE v_second record;
BEGIN
  SELECT * INTO v_second FROM tanaghom.claim_ghl_inbound_event_job();
  IF v_second.job_id IS NOT NULL THEN RAISE EXCEPTION 'conversation concurrency limit was exceeded'; END IF;
END;
$$;
SELECT tanaghom.complete_ghl_inbound_event(
  :'capacity_first_job_id'::uuid,
  jsonb_build_object('contract_version','phase5.ghl-inbound-event-result.v1',
    'event_id',:'capacity_first_event_id'::uuid,'outcome','ignored_without_action','external_action_count',0)
);
SELECT * FROM tanaghom.claim_ghl_inbound_event_job() \gset capacity_background_
SELECT tanaghom.complete_ghl_inbound_event(
  :'capacity_background_job_id'::uuid,
  jsonb_build_object('contract_version','phase5.ghl-inbound-event-result.v1',
    'event_id',:'capacity_background_event_id'::uuid,'outcome','ignored_without_action','external_action_count',0)
);
RESET ROLE;

SET ROLE tanaghom_api;
SELECT * FROM tanaghom.accept_ghl_inbound_event(
  '{"contract_version":"phase5.ghl-inbound-event.v1","provider_event_id":"capacity-cooldown-1","provider_event_type":"InboundMessage","location_id":"location-capacity-test","contact_id":"capacity-contact-3","conversation_id":"capacity-conversation-3","message_id":"capacity-message-2","channel":"whatsapp","direction":"inbound","occurred_at":"2026-07-15T10:00:02Z","details":{"body":"Throttle test"}}'::jsonb,
  repeat('3',64)
);
SELECT * FROM tanaghom.accept_ghl_inbound_event(
  '{"contract_version":"phase5.ghl-inbound-event.v1","provider_event_id":"capacity-cooldown-2","provider_event_type":"InboundMessage","location_id":"location-capacity-test","contact_id":"capacity-contact-4","conversation_id":"capacity-conversation-4","message_id":"capacity-message-3","channel":"whatsapp","direction":"inbound","occurred_at":"2026-07-15T10:00:03Z","details":{"body":"Throttle peer"}}'::jsonb,
  repeat('4',64)
);
RESET ROLE;

SET ROLE tanaghom_conversation_worker;
SELECT * FROM tanaghom.claim_ghl_inbound_event_job() \gset capacity_throttled_
SELECT tanaghom.record_ghl_inbound_event_failure(
  :'capacity_throttled_job_id'::uuid,'gemma_rate_limited','Simulated model throttle',1
);
DO $$
DECLARE v_blocked record;
BEGIN
  SELECT * INTO v_blocked FROM tanaghom.claim_ghl_inbound_event_job();
  IF v_blocked.job_id IS NOT NULL THEN RAISE EXCEPTION 'active Gemma cooldown did not stop new claims'; END IF;
END;
$$;
SELECT pg_sleep(1.1);
SELECT * FROM tanaghom.claim_ghl_inbound_event_job() \gset capacity_recovered_
SELECT tanaghom.complete_ghl_inbound_event(
  :'capacity_recovered_job_id'::uuid,
  jsonb_build_object('contract_version','phase5.ghl-inbound-event-result.v1',
    'event_id',:'capacity_recovered_event_id'::uuid,'outcome','ignored_without_action','external_action_count',0)
);
SELECT * FROM tanaghom.claim_ghl_inbound_event_job() \gset capacity_remaining_
SELECT tanaghom.complete_ghl_inbound_event(
  :'capacity_remaining_job_id'::uuid,
  jsonb_build_object('contract_version','phase5.ghl-inbound-event-result.v1',
    'event_id',:'capacity_remaining_event_id'::uuid,'outcome','ignored_without_action','external_action_count',0)
);
RESET ROLE;

DO $$
DECLARE v_status record;
BEGIN
  SELECT * INTO v_status FROM tanaghom.conversation_capacity_status
   WHERE organization_id='10000000-0000-4000-8000-000000000001';
  IF v_status.queue_depth<>0 OR v_status.processing_count<>0 OR v_status.dead_letter_count<>0
     OR v_status.max_conversation_concurrency<>1 THEN
    RAISE EXCEPTION 'capacity status did not reconcile the disposable queue';
  END IF;
  IF has_table_privilege('tanaghom_conversation_worker','tanaghom.conversation_capacity_policies','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_conversation_worker','tanaghom.conversation_dependency_cooldowns','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_n8n_worker','tanaghom.conversation_dependency_cooldowns','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'workers gained direct capacity-control table access';
  END IF;
  IF NOT has_function_privilege('tanaghom_api',
       'tanaghom.set_conversation_capacity_policy(uuid,integer,integer,integer,integer,integer,integer,uuid)','EXECUTE')
     OR has_function_privilege('tanaghom_conversation_worker',
       'tanaghom.set_conversation_capacity_policy(uuid,integer,integer,integer,integer,integer,integer,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'capacity policy function role boundary is incorrect';
  END IF;
END;
$$;

UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,
  reason='Disposable capacity test complete' WHERE provider='ghl';
UPDATE tanaghom.integration_connections SET status='disconnected',credential_ciphertext=NULL,
  credential_nonce=NULL,credential_auth_tag=NULL,credential_key_version=NULL,secret_last_four=NULL,
  configuration='{}'::jsonb,disconnected_at=now() WHERE provider='ghl';

SELECT 'PASS: priority, bounded concurrency, dependency cooldown, recovery, visibility, and least privilege enforced.' AS result;
