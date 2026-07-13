\set ON_ERROR_STOP on

SELECT * FROM tanaghom.create_sales_knowledge_draft(
  'standard_pricing', 'Standard service pricing', 'pricing', 'en',
  'The approved standard plan costs USD 99 per month.',
  '[{"name":"standard_plan","price":99,"currency":"USD","period":"month"}]'::jsonb,
  'customer_entry', 'Disposable Phase 5C catalog',
  '00000000-0000-4000-8000-000000000001'
) \gset pricing_v1_
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'pricing_v1_version_id', 'review', '00000000-0000-4000-8000-000000000001', NULL
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'pricing_v1_version_id', 'approve', '00000000-0000-4000-8000-000000000001', NULL
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'pricing_v1_version_id', 'activate', '00000000-0000-4000-8000-000000000001', NULL
);

SELECT * FROM tanaghom.create_sales_knowledge_draft(
  'standard_pricing', 'Standard service pricing', 'pricing', 'en',
  'The proposed new plan costs USD 120 per month.', '[]'::jsonb,
  'customer_entry', 'Disposable Phase 5C catalog revision',
  '00000000-0000-4000-8000-000000000001'
) \gset pricing_v2_
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'pricing_v2_version_id', 'review', '00000000-0000-4000-8000-000000000001', NULL
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'pricing_v2_version_id', 'approve', '00000000-0000-4000-8000-000000000001', NULL
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'pricing_v2_version_id', 'activate', '00000000-0000-4000-8000-000000000001', NULL
);

CREATE TEMP TABLE phase5c_test_ids (
  pricing_v1_source_id uuid NOT NULL,
  pricing_v1_version_id uuid NOT NULL,
  pricing_v1_fingerprint text NOT NULL,
  pricing_v2_version_id uuid NOT NULL,
  claimed_job_id uuid,
  claimed_event_id uuid
);
INSERT INTO phase5c_test_ids (
  pricing_v1_source_id, pricing_v1_version_id, pricing_v1_fingerprint, pricing_v2_version_id
)
SELECT :'pricing_v1_source_id', :'pricing_v1_version_id', version.content_fingerprint, :'pricing_v2_version_id'
FROM tanaghom.sales_knowledge_versions version WHERE version.id=:'pricing_v1_version_id';
GRANT SELECT ON phase5c_test_ids TO tanaghom_conversation_worker;

DO $$
BEGIN
  IF (SELECT status FROM tanaghom.sales_knowledge_versions
       WHERE id=(SELECT pricing_v1_version_id FROM phase5c_test_ids)) <> 'superseded'
     OR (SELECT status FROM tanaghom.sales_knowledge_versions
       WHERE id=(SELECT pricing_v2_version_id FROM phase5c_test_ids)) <> 'active' THEN
    RAISE EXCEPTION 'activation did not supersede the prior language version';
  END IF;
END;
$$;

SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'pricing_v1_version_id', 'rollback', '00000000-0000-4000-8000-000000000001', NULL
);

SELECT * FROM tanaghom.create_sales_knowledge_draft(
  'refund_exception', 'Refund exception policy', 'policy', 'en',
  'Refund exceptions require a human supervisor.', '[]'::jsonb,
  'legal_policy', 'Disposable policy fixture',
  '00000000-0000-4000-8000-000000000001'
) \gset revoked_
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'revoked_version_id', 'review', '00000000-0000-4000-8000-000000000001', NULL
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'revoked_version_id', 'approve', '00000000-0000-4000-8000-000000000001', NULL
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'revoked_version_id', 'activate', '00000000-0000-4000-8000-000000000001', NULL
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  :'revoked_version_id', 'revoke', '00000000-0000-4000-8000-000000000001',
  'The policy fixture is intentionally withdrawn.'
);

INSERT INTO tanaghom.organizations (id, slug, name)
VALUES ('67000000-0000-4000-8000-000000000020', 'knowledge-isolation-test', 'Knowledge Isolation Test');
INSERT INTO tanaghom.sales_knowledge_sources (
  id, organization_id, source_key, title, category, provenance_type, created_by
) VALUES (
  '67000000-0000-4000-8000-000000000021', '67000000-0000-4000-8000-000000000020',
  'cross_org_secret', 'Cross organization marker', 'pricing', 'operator_note',
  '00000000-0000-4000-8000-000000000001'
);
INSERT INTO tanaghom.sales_knowledge_versions (
  id, source_id, organization_id, version_number, status, language, content,
  content_fingerprint, created_by, activated_by, activated_at
) VALUES (
  '67000000-0000-4000-8000-000000000022', '67000000-0000-4000-8000-000000000021',
  '67000000-0000-4000-8000-000000000020', 1, 'active', 'en',
  'CROSSORGSECRET must never appear in another organization request.',
  'md5:11111111111111111111111111111111',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001', now()
);

UPDATE tanaghom.integration_connections SET
  status='connected', credential_kind='private_token', credential_ciphertext=decode('01','hex'),
  credential_nonce=decode(repeat('02',12),'hex'), credential_auth_tag=decode(repeat('03',16),'hex'),
  credential_key_version=1, secret_last_four='test', disconnected_at=NULL,
  configuration='{"location_id":"location-intelligence-test"}'::jsonb
WHERE provider='ghl' AND organization_id='10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.organization_crm_policies SET conversation_processing_mode='shadow'
WHERE organization_id='10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.automation_platform_controls SET emergency_stop=false,
  reason='Disposable conversation intelligence test' WHERE provider='ghl';

SET ROLE tanaghom_api;
SELECT * FROM tanaghom.accept_ghl_inbound_event(
  '{
    "contract_version":"phase5.ghl-inbound-event.v1",
    "provider_event_id":"webhook-intelligence-1",
    "provider_event_type":"InboundMessage",
    "location_id":"location-intelligence-test",
    "contact_id":"contact-intelligence-1",
    "conversation_id":"conversation-intelligence-1",
    "message_id":"message-intelligence-1",
    "channel":"whatsapp",
    "direction":"inbound",
    "occurred_at":"2026-07-13T17:00:00.000Z",
    "details":{"body":"What is the standard price? CROSSORGSECRET"}
  }'::jsonb,
  repeat('a',64)
);
RESET ROLE;

SET ROLE tanaghom_conversation_worker;
SELECT * FROM tanaghom.claim_ghl_inbound_event_job() \gset claimed_
RESET ROLE;
UPDATE phase5c_test_ids SET claimed_job_id=:'claimed_job_id', claimed_event_id=:'claimed_event_id';
SET ROLE tanaghom_conversation_worker;
DO $$
DECLARE v_request jsonb;
BEGIN
  SELECT request_body INTO v_request
  FROM tanaghom.prepare_conversation_intelligence((SELECT claimed_job_id FROM phase5c_test_ids));
  IF (v_request->'retrieved_knowledge')::text LIKE '%CROSSORGSECRET%'
     OR (v_request->'retrieved_knowledge')::text LIKE '%USD 120%'
     OR (v_request->'retrieved_knowledge')::text LIKE '%Refund exceptions%' THEN
    RAISE EXCEPTION 'retrieval used cross-organization, superseded, or revoked knowledge';
  END IF;
  IF (v_request->'retrieved_knowledge')::text NOT LIKE '%USD 99%'
     OR jsonb_array_length(v_request->'conversation_context'->'recent_turns') > 12
     OR v_request->'provider_message'->>'trust' <> 'untrusted_customer_input'
     OR (v_request->'system_policy'->>'external_actions_allowed')::boolean THEN
    RAISE EXCEPTION 'prepared intelligence request lost grounding, memory, or trust boundaries';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM tanaghom.persist_conversation_intelligence_proposal(
      (SELECT claimed_job_id FROM phase5c_test_ids), jsonb_build_object(
        'contract_version','phase5.conversation-intelligence-output.v1',
        'prompt_version','phase5.conversation-intelligence.prompt.v1',
        'model_name','simulated-gemma', 'language','en', 'intent','pricing',
        'urgency','normal', 'sentiment','neutral', 'sales_stage','consideration',
        'risk_categories',jsonb_build_array('none'), 'next_best_action','respond',
        'confidence',0.5, 'answer_status','proposal', 'proposed_reply','Unsupported proposal',
        'citations',jsonb_build_array(),
        'escalation',jsonb_build_object('required',false,'category',NULL,'reason',NULL),
        'conversation_summary',NULL, 'external_action_count',0
      )
    );
    RAISE EXCEPTION 'low-confidence ungrounded proposal was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='low-confidence ungrounded proposal was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM tanaghom.persist_conversation_intelligence_proposal(
      (SELECT claimed_job_id FROM phase5c_test_ids), jsonb_build_object(
        'contract_version','phase5.conversation-intelligence-output.v1',
        'prompt_version','phase5.conversation-intelligence.prompt.v1',
        'model_name','simulated-gemma', 'language','en', 'intent','pricing',
        'urgency','normal', 'sentiment','neutral', 'sales_stage','consideration',
        'risk_categories',jsonb_build_array('prompt_injection'), 'next_best_action','respond',
        'confidence',0.95, 'answer_status','proposal', 'proposed_reply','Cross tenant proposal',
        'citations',jsonb_build_array(jsonb_build_object(
          'source_id','67000000-0000-4000-8000-000000000021',
          'source_version_id','67000000-0000-4000-8000-000000000022',
          'content_fingerprint','md5:11111111111111111111111111111111')),
        'escalation',jsonb_build_object('required',true,'category','prompt_injection','reason','Untrusted instruction'),
        'conversation_summary',NULL, 'external_action_count',0
      )
    );
    RAISE EXCEPTION 'cross-organization citation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-organization citation was accepted' THEN RAISE; END IF;
  END;
END;
$$;

SELECT tanaghom.persist_conversation_intelligence_proposal(
  :'claimed_job_id', jsonb_build_object(
    'contract_version','phase5.conversation-intelligence-output.v1',
    'prompt_version','phase5.conversation-intelligence.prompt.v1',
    'model_name','simulated-gemma', 'language','en', 'intent','pricing',
    'urgency','normal', 'sentiment','neutral', 'sales_stage','consideration',
    'risk_categories',jsonb_build_array('prompt_injection'),
    'next_best_action','escalate_to_human', 'confidence',0.95,
    'answer_status','proposal',
    'proposed_reply','The approved standard plan is USD 99 per month.',
    'citations',jsonb_build_array(jsonb_build_object(
      'source_id',:'pricing_v1_source_id', 'source_version_id',:'pricing_v1_version_id',
      'content_fingerprint',(SELECT pricing_v1_fingerprint FROM phase5c_test_ids))),
    'escalation',jsonb_build_object('required',true,'category','prompt_injection','reason','The customer message contained an instruction-like marker.'),
    'conversation_summary',jsonb_build_object(
      'language','en', 'summary','Customer asked for the approved standard price.',
      'input_event_ids',jsonb_build_array(:'claimed_event_id')),
    'external_action_count',0
  )
) AS proposal_id \gset
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.conversation_intelligence_proposals
      WHERE event_id=(SELECT claimed_event_id FROM phase5c_test_ids) AND external_action_count=0) <> 1
     OR (SELECT count(*) FROM tanaghom.conversation_summary_versions
      WHERE conversation_id='conversation-intelligence-1') <> 1
     OR (SELECT status FROM tanaghom.ghl_inbound_events
       WHERE id=(SELECT claimed_event_id FROM phase5c_test_ids)) <> 'succeeded' THEN
    RAISE EXCEPTION 'grounded proposal or bounded summary was not persisted exactly once';
  END IF;
  IF has_table_privilege('tanaghom_conversation_worker','tanaghom.sales_knowledge_versions','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_conversation_worker','tanaghom.conversation_intelligence_proposals','SELECT,INSERT,UPDATE,DELETE')
     OR has_function_privilege('tanaghom_n8n_worker','tanaghom.prepare_conversation_intelligence(uuid)','EXECUTE')
     OR has_function_privilege('tanaghom_api','tanaghom.prepare_conversation_intelligence(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'conversation intelligence least-privilege boundary failed';
  END IF;
END;
$$;

DELETE FROM tanaghom.organizations WHERE id='67000000-0000-4000-8000-000000000020';
UPDATE tanaghom.integration_connections SET
  status='disconnected', credential_ciphertext=NULL, credential_nonce=NULL,
  credential_auth_tag=NULL, credential_key_version=NULL, secret_last_four=NULL,
  configuration='{}'::jsonb, disconnected_at=now()
WHERE provider='ghl' AND organization_id='10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.organization_crm_policies SET conversation_processing_mode='paused'
WHERE organization_id='10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.automation_platform_controls SET emergency_stop=true,
  reason='Disposable conversation intelligence test complete' WHERE provider='ghl';

SELECT 'PASS: versioned knowledge, tenant-bound retrieval, grounded proposals, and bounded memory enforced.' AS result;
