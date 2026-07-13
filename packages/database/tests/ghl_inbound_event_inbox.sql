\set ON_ERROR_STOP on

INSERT INTO tanaghom.integration_connections (
  organization_id, provider, status, base_url, credential_kind,
  credential_ciphertext, credential_nonce, credential_auth_tag,
  credential_key_version, secret_last_four, configuration, configured_by
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'ghl', 'connected',
  'https://services.leadconnectorhq.com', 'private_token', decode('01', 'hex'),
  decode(repeat('02', 12), 'hex'), decode(repeat('03', 16), 'hex'),
  1, 'test', '{"location_id":"location-inbound-test"}',
  '00000000-0000-4000-8000-000000000001'
);

INSERT INTO tanaghom.organizations (id, slug, name)
VALUES ('66000000-0000-4000-8000-000000000020', 'inbound-boundary-test', 'Inbound Boundary Test');
INSERT INTO tanaghom.app_users (
  id, email, display_name, kind, role, organization_id, auth_subject, accepted_at
) VALUES (
  '66000000-0000-4000-8000-000000000021', 'inbound-other-owner@example.test',
  'Inbound Other Owner', 'human', 'owner', '66000000-0000-4000-8000-000000000020',
  '66000000-0000-4000-8000-000000000024', now()
);

SET ROLE tanaghom_api;
DO $$
DECLARE v_first record; v_duplicate record;
BEGIN
  SELECT * INTO v_first FROM tanaghom.accept_ghl_inbound_event(
    '{
      "contract_version":"phase5.ghl-inbound-event.v1",
      "provider_event_id":"webhook-inbound-1",
      "provider_event_type":"InboundMessage",
      "location_id":"location-inbound-test",
      "contact_id":"contact-inbound-1",
      "conversation_id":"conversation-inbound-1",
      "message_id":"message-inbound-1",
      "channel":"whatsapp",
      "direction":"inbound",
      "occurred_at":"2026-07-13T12:00:00.000Z",
      "details":{"body":"Is this available?","content_type":"text/plain","status":"delivered"}
    }'::jsonb,
    repeat('a', 64)
  );
  SELECT * INTO v_duplicate FROM tanaghom.accept_ghl_inbound_event(
    '{
      "contract_version":"phase5.ghl-inbound-event.v1",
      "provider_event_id":"webhook-inbound-1",
      "provider_event_type":"InboundMessage",
      "location_id":"location-inbound-test",
      "contact_id":"contact-inbound-1",
      "conversation_id":"conversation-inbound-1",
      "message_id":"message-inbound-1",
      "channel":"whatsapp",
      "direction":"inbound",
      "occurred_at":"2026-07-13T12:00:00.000Z",
      "details":{"body":"Is this available?","content_type":"text/plain","status":"delivered"}
    }'::jsonb,
    repeat('a', 64)
  );
  IF v_first.event_id IS NULL OR v_first.duplicate OR NOT v_duplicate.duplicate
     OR v_first.event_id <> v_duplicate.event_id OR v_duplicate.delivery_count <> 2 THEN
    RAISE EXCEPTION 'signed delivery deduplication failed';
  END IF;
  PERFORM tanaghom.record_ghl_webhook_rejection('signature_invalid', repeat('b', 64));
  PERFORM tanaghom.record_ghl_webhook_rejection('signature_invalid', repeat('c', 64));
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.ghl_inbound_events WHERE provider_event_id='webhook-inbound-1') <> 1
     OR (SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type='conversation.ghl.inbound_event') <> 1 THEN
    RAISE EXCEPTION 'one event did not create exactly one downstream job';
  END IF;
  IF (SELECT rejection_count FROM tanaghom.ghl_webhook_rejection_metrics
      WHERE reason='signature_invalid' ORDER BY bucket_minute DESC LIMIT 1) <> 2 THEN
    RAISE EXCEPTION 'bounded rejection audit did not aggregate invalid signatures';
  END IF;
END;
$$;

SET ROLE tanaghom_conversation_worker;
DO $$
DECLARE v_claim record;
BEGIN
  SELECT * INTO v_claim FROM tanaghom.claim_ghl_inbound_event_job();
  IF v_claim.job_id IS NOT NULL THEN
    RAISE EXCEPTION 'paused/default emergency policy unexpectedly allowed a claim';
  END IF;
END;
$$;
RESET ROLE;

UPDATE tanaghom.organization_crm_policies
SET conversation_processing_mode='shadow'
WHERE organization_id='10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.automation_platform_controls
SET emergency_stop=false, reason='Disposable inbound inbox test'
WHERE provider='ghl';

SET ROLE tanaghom_conversation_worker;
DO $$
DECLARE v_claim record;
BEGIN
  SELECT * INTO v_claim FROM tanaghom.claim_ghl_inbound_event_job();
  IF v_claim.job_id IS NULL OR v_claim.event_payload->>'provider_event_id' <> 'webhook-inbound-1'
     OR v_claim.event_payload->'details'->>'body' <> 'Is this available?' THEN
    RAISE EXCEPTION 'conversation worker did not claim the normalized event';
  END IF;
END;
$$;
RESET ROLE;

UPDATE tanaghom.agent_jobs SET started_at=statement_timestamp() - interval '120 seconds'
WHERE job_type='conversation.ghl.inbound_event' AND status='running';
SET ROLE tanaghom_conversation_worker;
DO $$
BEGIN
  IF tanaghom.recover_stale_ghl_inbound_event_jobs(60) <> 1 THEN
    RAISE EXCEPTION 'stale worker claim was not recovered';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE tanaghom_conversation_worker;
DO $$
DECLARE v_claim record;
BEGIN
  SELECT * INTO v_claim FROM tanaghom.claim_ghl_inbound_event_job();
  IF v_claim.job_id IS NULL THEN RAISE EXCEPTION 'recovered event was not claimable'; END IF;
END;
$$;
RESET ROLE;

UPDATE tanaghom.agent_jobs SET attempt=max_attempts
WHERE job_type='conversation.ghl.inbound_event' AND status='running';
SELECT id AS inbound_job_id FROM tanaghom.agent_jobs
WHERE job_type='conversation.ghl.inbound_event' \gset
SET ROLE tanaghom_conversation_worker;
SELECT tanaghom.record_ghl_inbound_event_failure(
  :'inbound_job_id'::uuid, 'simulated_processor_failure', 'simulated bounded failure', 0
);
RESET ROLE;
DO $$
BEGIN
  IF (SELECT status FROM tanaghom.ghl_inbound_events WHERE provider_event_id='webhook-inbound-1') <> 'dead_letter' THEN
    RAISE EXCEPTION 'exhausted event did not enter dead letter';
  END IF;
END;
$$;

SET ROLE tanaghom_api;
DO $$
DECLARE v_event_id uuid;
BEGIN
  SELECT id INTO v_event_id FROM tanaghom.ghl_inbound_events
   WHERE provider_event_id='webhook-inbound-1';
  BEGIN
    PERFORM * FROM tanaghom.replay_ghl_inbound_event(
      v_event_id, '66000000-0000-4000-8000-000000000021'
    );
    RAISE EXCEPTION 'cross-organization operator replayed an event';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-organization operator replayed an event' THEN RAISE; END IF;
  END;
  PERFORM * FROM tanaghom.replay_ghl_inbound_event(
    v_event_id, '00000000-0000-4000-8000-000000000001'
  );
END;
$$;
RESET ROLE;

-- Remove the cross-organization authorization fixtures before the migration
-- rollback test. The authorized replay audit belongs to the seeded owner, so
-- these disposable rows have no retained evidence dependencies.
DELETE FROM tanaghom.app_users
WHERE id = '66000000-0000-4000-8000-000000000021';
DELETE FROM tanaghom.organizations
WHERE id = '66000000-0000-4000-8000-000000000020';

SET ROLE tanaghom_conversation_worker;
DO $$
DECLARE v_claim record; v_status text;
BEGIN
  SELECT * INTO v_claim FROM tanaghom.claim_ghl_inbound_event_job();
  SELECT tanaghom.complete_ghl_inbound_event(
    v_claim.job_id,
    jsonb_build_object(
      'contract_version', 'phase5.ghl-inbound-event-result.v1',
      'event_id', v_claim.event_id,
      'outcome', 'accepted_for_conversation_intelligence',
      'external_action_count', 0
    )
  ) INTO v_status;
  IF v_status <> 'succeeded' THEN RAISE EXCEPTION 'replayed event did not complete'; END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT status FROM tanaghom.ghl_inbound_events WHERE provider_event_id='webhook-inbound-1') <> 'succeeded'
     OR (SELECT replay_count FROM tanaghom.ghl_inbound_events WHERE provider_event_id='webhook-inbound-1') <> 1
     OR (SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type='conversation.ghl.inbound_event') <> 1 THEN
    RAISE EXCEPTION 'controlled replay did not preserve one event and one job';
  END IF;
  IF has_table_privilege('tanaghom_conversation_worker', 'tanaghom.ghl_inbound_events', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_conversation_worker', 'tanaghom.integration_connections', 'SELECT')
     OR has_table_privilege('tanaghom_conversation_worker', 'tanaghom.content_approvals', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'conversation worker gained direct table or approval access';
  END IF;
  IF NOT has_function_privilege('tanaghom_conversation_worker', 'tanaghom.claim_ghl_inbound_event_job()', 'EXECUTE')
     OR has_function_privilege('tanaghom_n8n_worker', 'tanaghom.claim_ghl_inbound_event_job()', 'EXECUTE')
     OR has_function_privilege('tanaghom_api', 'tanaghom.claim_ghl_inbound_event_job()', 'EXECUTE') THEN
    RAISE EXCEPTION 'conversation claim role boundary is incorrect';
  END IF;
END;
$$;

UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,
  reason='Disposable inbound inbox test complete' WHERE provider='ghl';
UPDATE tanaghom.integration_connections
SET status = 'disconnected',
    credential_ciphertext = NULL,
    credential_nonce = NULL,
    credential_auth_tag = NULL,
    credential_key_version = NULL,
    secret_last_four = NULL,
    configuration = '{}'::jsonb,
    disconnected_at = now()
WHERE provider = 'ghl';

SELECT 'PASS: signed GHL events are durable, deduplicated, recoverable, and least-privileged.' AS result;
