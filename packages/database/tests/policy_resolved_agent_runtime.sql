\set ON_ERROR_STOP on

BEGIN;

INSERT INTO tanaghom.organizations(id,slug,name)
VALUES (
  '10000000-0000-4000-8000-0000000000d2',
  'phase7d-second-tenant',
  'Phase 7D Second Tenant'
);
INSERT INTO tanaghom.app_users(
  id,email,display_name,kind,role,auth_subject,accepted_at,organization_id
) VALUES (
  '00000000-0000-4000-8000-0000000000d2',
  'phase7d-owner@example.test',
  'Phase 7D Owner',
  'human','owner',
  '90000000-0000-4000-8000-0000000000d2',
  statement_timestamp(),
  '10000000-0000-4000-8000-0000000000d2'
);

SELECT * FROM tanaghom.create_organization_agent_draft(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '{
    "code":"campaign_runtime_test",
    "template_code":"campaign_planning",
    "display_name":"Campaign Runtime Test Agent",
    "description":"Plans a bounded campaign strategy in the shared disposable policy runtime.",
    "objective":"Prove tenant-safe campaign planning through one shared runner.",
    "responsibility":"Prepare a campaign strategy proposal and stop before any provider action.",
    "tone":"Clear and evidence-based",
    "brand_profile_key":"brand/tanaghom",
    "languages":["en","ar"],
    "knowledge_keys":[],
    "skills":[{
      "skill_source":"platform",
      "skill_version_id":"72000000-0000-4000-8000-000000000001",
      "operating_mode":"shadow",
      "approval_required":true,
      "constraints":{}
    }],
    "integrations":[],
    "policy":{
      "business_timezone":"Asia/Amman",
      "business_hours":[],
      "allowed_channels":["facebook","instagram"],
      "consent_required":false,
      "max_steps":4,
      "max_tool_calls":4,
      "max_retries":2,
      "max_concurrency":2,
      "max_runtime_seconds":300,
      "max_tokens":6000,
      "max_daily_actions":0,
      "max_actions_per_minute":0,
      "max_follow_ups_per_contact":0,
      "monthly_budget":0,
      "allowed_record_types":["campaign"],
      "allowed_action_types":["proposal.create"],
      "approval_actions":["provider.external_write"],
      "approval_roles":["owner","reviewer"],
      "approval_expiry_minutes":60,
      "parameter_bound_approval":true,
      "escalation_conditions":["Escalate when the approved campaign brief is incomplete."]
    }
  }',
  'sha256:d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1',
  NULL
);

SELECT * FROM tanaghom.transition_organization_agent_version(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  (SELECT version.id
     FROM tanaghom.organization_agent_versions version
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='campaign_runtime_test'),
  'validate',
  '{"valid":true,"validator_version":"phase7d-disposable","runtime_certified":false}'
);

SELECT * FROM tanaghom.create_organization_agent_draft(
  '10000000-0000-4000-8000-0000000000d2',
  '00000000-0000-4000-8000-0000000000d2',
  '{
    "code":"conversation_runtime_test",
    "template_code":"lead_qualification",
    "display_name":"Conversation Runtime Test Agent",
    "description":"Proposes a grounded reply in the shared disposable policy runtime.",
    "objective":"Prove tenant-safe bilingual conversation planning through one shared runner.",
    "responsibility":"Prepare a grounded reply proposal and stop before sending a provider message.",
    "tone":"Calm and direct",
    "brand_profile_key":"brand/second_tenant",
    "languages":["en","ar"],
    "knowledge_keys":[],
    "skills":[{
      "skill_source":"platform",
      "skill_version_id":"72000000-0000-4000-8000-000000000006",
      "operating_mode":"shadow",
      "approval_required":true,
      "constraints":{}
    }],
    "integrations":[],
    "policy":{
      "business_timezone":"Asia/Amman",
      "business_hours":[],
      "allowed_channels":["whatsapp"],
      "consent_required":true,
      "max_steps":4,
      "max_tool_calls":4,
      "max_retries":2,
      "max_concurrency":2,
      "max_runtime_seconds":300,
      "max_tokens":6000,
      "max_daily_actions":0,
      "max_actions_per_minute":0,
      "max_follow_ups_per_contact":2,
      "monthly_budget":0,
      "allowed_record_types":["conversation"],
      "allowed_action_types":["proposal.create"],
      "approval_actions":["provider.external_write"],
      "approval_roles":["owner","reviewer"],
      "approval_expiry_minutes":60,
      "parameter_bound_approval":true,
      "escalation_conditions":["Escalate when consent or grounded evidence is missing."]
    }
  }',
  'sha256:d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2',
  NULL
);

SELECT * FROM tanaghom.transition_organization_agent_version(
  '10000000-0000-4000-8000-0000000000d2',
  '00000000-0000-4000-8000-0000000000d2',
  (SELECT version.id
     FROM tanaghom.organization_agent_versions version
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='conversation_runtime_test'),
  'validate',
  '{"valid":true,"validator_version":"phase7d-disposable","runtime_certified":false}'
);

CREATE TEMP TABLE phase7d_test_ids(
  label text PRIMARY KEY,
  job_id uuid,
  run_id uuid,
  invocation_id uuid,
  context jsonb
);

INSERT INTO phase7d_test_ids(label,job_id)
SELECT 'campaign',job_id FROM tanaghom.queue_organization_agent_job(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  (SELECT version.id
     FROM tanaghom.organization_agent_versions version
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='campaign_runtime_test'),
  '7d000000-0000-4000-8000-000000000001',
  (SELECT scenario.id
     FROM tanaghom.organization_agent_test_scenarios scenario
     JOIN tanaghom.organization_agent_versions version ON version.id=scenario.agent_version_id
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='campaign_runtime_test'
      AND scenario.code='en_success'),
  NULL,
  '7d100000-0000-4000-8000-000000000001',
  'phase7d:campaign:success',
  'sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
  'scenario',NULL,false,'en',
  '{"brief":"Approved disposable campaign brief.","record_type":"campaign"}'
);

INSERT INTO phase7d_test_ids(label,job_id)
SELECT 'conversation',job_id FROM tanaghom.queue_organization_agent_job(
  '10000000-0000-4000-8000-0000000000d2',
  '00000000-0000-4000-8000-0000000000d2',
  (SELECT version.id
     FROM tanaghom.organization_agent_versions version
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='conversation_runtime_test'),
  '7d000000-0000-4000-8000-000000000001',
  (SELECT scenario.id
     FROM tanaghom.organization_agent_test_scenarios scenario
     JOIN tanaghom.organization_agent_versions version ON version.id=scenario.agent_version_id
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='conversation_runtime_test'
      AND scenario.code='ar_success'),
  NULL,
  '7d100000-0000-4000-8000-000000000002',
  'phase7d:conversation:success',
  'sha256:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
  'scenario','whatsapp',true,'ar',
  '{"message":"مرحبا، أحتاج معلومات موثوقة.","record_type":"conversation"}'
);

DO $$
BEGIN
  BEGIN
    PERFORM tanaghom.queue_organization_agent_job(
      '10000000-0000-4000-8000-0000000000d2',
      '00000000-0000-4000-8000-0000000000d2',
      (SELECT version.id
         FROM tanaghom.organization_agent_versions version
         JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
        WHERE definition.code='campaign_runtime_test'),
      '7d000000-0000-4000-8000-000000000001',
      NULL,NULL,gen_random_uuid(),'phase7d:cross-tenant',
      'sha256:abababababababababababababababababababababababababababababababab',
      'human_request',NULL,false,'en','{"test":true}'
    );
    RAISE EXCEPTION 'cross-tenant agent job unexpectedly queued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-tenant agent job unexpectedly queued' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM tanaghom.queue_organization_agent_job(
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      (SELECT version.id
         FROM tanaghom.organization_agent_versions version
         JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
        WHERE definition.code='campaign_runtime_test'),
      '7d000000-0000-4000-8000-000000000001',
      NULL,gen_random_uuid(),gen_random_uuid(),'phase7d:forged-handoff',
      'sha256:acacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac',
      'agent_handoff',NULL,false,'en','{"test":true}'
    );
    RAISE EXCEPTION 'human/API path unexpectedly forged an agent handoff';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='human/API path unexpectedly forged an agent handoff' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.claim_organization_agent_job('runtime-before-go'))<>0 THEN
    RAISE EXCEPTION 'runtime emergency stop did not block claims';
  END IF;
END;
$$;

UPDATE tanaghom.agent_runtime_controls
   SET emergency_stop=false,reason='Disposable Phase 7D runtime contract test',
       updated_at=statement_timestamp()
 WHERE singleton;

WITH claimed AS (
  SELECT * FROM tanaghom.claim_organization_agent_job('shared-runner-a')
)
UPDATE phase7d_test_ids ids
   SET run_id=claimed.run_id,context=claimed.planner_context
  FROM claimed WHERE ids.job_id=claimed.job_id;
WITH claimed AS (
  SELECT * FROM tanaghom.claim_organization_agent_job('shared-runner-b')
)
UPDATE phase7d_test_ids ids
   SET run_id=claimed.run_id,context=claimed.planner_context
  FROM claimed WHERE ids.job_id=claimed.job_id;

DO $$
BEGIN
  IF (SELECT count(*) FROM phase7d_test_ids WHERE run_id IS NOT NULL)<>2
    OR EXISTS (
      SELECT 1 FROM phase7d_test_ids
       WHERE context::text ~* 'Produce a contract-valid strategy proposal|Return a grounded cited reply'
    )
    OR EXISTS (
      SELECT 1 FROM phase7d_test_ids
       WHERE jsonb_array_length(context->'skill_catalog')<>1
    )
    OR (
      SELECT context->>'organization_id' FROM phase7d_test_ids WHERE label='campaign'
    )=(
      SELECT context->>'organization_id' FROM phase7d_test_ids WHERE label='conversation'
    )
  THEN
    RAISE EXCEPTION 'shared runner did not preserve tenant isolation or progressive skill disclosure';
  END IF;
  IF (SELECT count(*) FROM tanaghom.resolve_agent_skill_instructions(
    (SELECT run_id FROM phase7d_test_ids WHERE label='campaign'),
    'create_campaign_strategy'
  ))<>1 OR (SELECT count(*) FROM tanaghom.resolve_agent_skill_instructions(
    (SELECT run_id FROM phase7d_test_ids WHERE label='campaign'),
    'propose_conversation_reply'
  ))<>0 THEN
    RAISE EXCEPTION 'on-demand skill instruction resolution crossed an assignment boundary';
  END IF;
END;
$$;

SELECT tanaghom.record_agent_runtime_plan(
  (SELECT run_id FROM phase7d_test_ids WHERE label='campaign'),
  jsonb_build_object(
    'contract_version','phase7.agent-runtime-plan.v1',
    'agent_version_id',(
      SELECT context->'agent'->>'version_id' FROM phase7d_test_ids WHERE label='campaign'
    ),
    'agent_content_hash',(
      SELECT context->'agent'->>'content_hash' FROM phase7d_test_ids WHERE label='campaign'
    ),
    'language','en',
    'intent_summary','Prepare one strategy and reject an unassigned CRM operation.',
    'steps',jsonb_build_array(
      jsonb_build_object(
        'sequence',1,'skill_code','create_campaign_strategy',
        'operation','campaign.strategy.propose','channel',NULL,
        'consent_evidence','not_required',
        'arguments_json','{"record_type":"campaign","brief":"approved"}',
        'idempotency_key','phase7d:campaign:step:1',
        'rationale','The assigned proposal skill matches the approved brief.'
      ),
      jsonb_build_object(
        'sequence',2,'skill_code','execute_governed_ghl_action',
        'operation','ghl.message.execute','channel','whatsapp',
        'consent_evidence','missing',
        'arguments_json','{"record_type":"conversation","message":"blocked"}',
        'idempotency_key','phase7d:campaign:step:2',
        'rationale','This intentionally tests an unassigned model-selected tool.'
      )
    ),
    'final_response_mode','result_summary'
  ),
  'sha256:b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
  100,50
);

SELECT tanaghom.record_agent_runtime_plan(
  (SELECT run_id FROM phase7d_test_ids WHERE label='conversation'),
  jsonb_build_object(
    'contract_version','phase7.agent-runtime-plan.v1',
    'agent_version_id',(
      SELECT context->'agent'->>'version_id' FROM phase7d_test_ids WHERE label='conversation'
    ),
    'agent_content_hash',(
      SELECT context->'agent'->>'content_hash' FROM phase7d_test_ids WHERE label='conversation'
    ),
    'language','ar',
    'intent_summary','Prepare one grounded reply and prove channel, consent, and emergency refusals.',
    'steps',jsonb_build_array(
      jsonb_build_object(
        'sequence',1,'skill_code','propose_conversation_reply',
        'operation','conversation.reply.propose','channel','whatsapp',
        'consent_evidence','verified',
        'arguments_json','{"record_type":"conversation","message":"مرحبا"}',
        'idempotency_key','phase7d:conversation:step:1',
        'rationale','The assigned proposal skill matches the consented channel.'
      ),
      jsonb_build_object(
        'sequence',2,'skill_code','propose_conversation_reply',
        'operation','conversation.reply.propose','channel','linkedin',
        'consent_evidence','verified',
        'arguments_json','{"record_type":"conversation","message":"wrong channel"}',
        'idempotency_key','phase7d:conversation:step:2',
        'rationale','This intentionally tests a wrong model-selected channel.'
      ),
      jsonb_build_object(
        'sequence',3,'skill_code','propose_conversation_reply',
        'operation','conversation.reply.propose','channel','whatsapp',
        'consent_evidence','missing',
        'arguments_json','{"record_type":"conversation","message":"missing consent"}',
        'idempotency_key','phase7d:conversation:step:3',
        'rationale','This intentionally tests missing consent.'
      ),
      jsonb_build_object(
        'sequence',4,'skill_code','propose_conversation_reply',
        'operation','conversation.reply.propose','channel','whatsapp',
        'consent_evidence','verified',
        'arguments_json','{"record_type":"conversation","message":"emergency stop"}',
        'idempotency_key','phase7d:conversation:step:4',
        'rationale','This intentionally tests the platform emergency stop.'
      )
    ),
    'final_response_mode','human_escalation'
  ),
  'sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
  120,60
);

SELECT * FROM tanaghom.authorize_agent_skill_invocation(
  (SELECT run_id FROM phase7d_test_ids WHERE label='campaign'),
  (SELECT value FROM jsonb_array_elements(
    (SELECT plan->'steps' FROM tanaghom.organization_agent_runs
      WHERE id=(SELECT run_id FROM phase7d_test_ids WHERE label='campaign'))
  ) value WHERE value->>'sequence'='1'),
  'sha256:c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1'
);
SELECT * FROM tanaghom.authorize_agent_skill_invocation(
  (SELECT run_id FROM phase7d_test_ids WHERE label='campaign'),
  (SELECT value FROM jsonb_array_elements(
    (SELECT plan->'steps' FROM tanaghom.organization_agent_runs
      WHERE id=(SELECT run_id FROM phase7d_test_ids WHERE label='campaign'))
  ) value WHERE value->>'sequence'='2'),
  'sha256:c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2'
);

SELECT * FROM tanaghom.authorize_agent_skill_invocation(
  (SELECT run_id FROM phase7d_test_ids WHERE label='conversation'),
  (SELECT value FROM jsonb_array_elements(
    (SELECT plan->'steps' FROM tanaghom.organization_agent_runs
      WHERE id=(SELECT run_id FROM phase7d_test_ids WHERE label='conversation'))
  ) value WHERE value->>'sequence'='1'),
  'sha256:c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'
);
SELECT * FROM tanaghom.authorize_agent_skill_invocation(
  (SELECT run_id FROM phase7d_test_ids WHERE label='conversation'),
  (SELECT value FROM jsonb_array_elements(
    (SELECT plan->'steps' FROM tanaghom.organization_agent_runs
      WHERE id=(SELECT run_id FROM phase7d_test_ids WHERE label='conversation'))
  ) value WHERE value->>'sequence'='2'),
  'sha256:c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4'
);
SELECT * FROM tanaghom.authorize_agent_skill_invocation(
  (SELECT run_id FROM phase7d_test_ids WHERE label='conversation'),
  (SELECT value FROM jsonb_array_elements(
    (SELECT plan->'steps' FROM tanaghom.organization_agent_runs
      WHERE id=(SELECT run_id FROM phase7d_test_ids WHERE label='conversation'))
  ) value WHERE value->>'sequence'='3'),
  'sha256:c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5'
);

UPDATE tanaghom.agent_runtime_controls
   SET emergency_stop=true,reason='Disposable emergency-stop refusal test',
       updated_at=statement_timestamp()
 WHERE singleton;
SELECT * FROM tanaghom.authorize_agent_skill_invocation(
  (SELECT run_id FROM phase7d_test_ids WHERE label='conversation'),
  (SELECT value FROM jsonb_array_elements(
    (SELECT plan->'steps' FROM tanaghom.organization_agent_runs
      WHERE id=(SELECT run_id FROM phase7d_test_ids WHERE label='conversation'))
  ) value WHERE value->>'sequence'='4'),
  'sha256:c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6'
);
UPDATE tanaghom.agent_runtime_controls
   SET emergency_stop=false,reason='Resume disposable simulation dispatch',
       updated_at=statement_timestamp()
 WHERE singleton;

DO $$
DECLARE
  v_first uuid;
  v_duplicate uuid;
BEGIN
  SELECT id INTO v_first FROM tanaghom.organization_agent_invocations
   WHERE idempotency_key='phase7d:campaign:step:1';
  SELECT invocation_id INTO v_duplicate FROM tanaghom.authorize_agent_skill_invocation(
    (SELECT run_id FROM phase7d_test_ids WHERE label='campaign'),
    (SELECT value FROM jsonb_array_elements(
      (SELECT plan->'steps' FROM tanaghom.organization_agent_runs
        WHERE id=(SELECT run_id FROM phase7d_test_ids WHERE label='campaign'))
    ) value WHERE value->>'sequence'='1'),
    'sha256:c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1'
  );
  IF v_first IS DISTINCT FROM v_duplicate
    OR (SELECT count(*) FROM tanaghom.organization_agent_invocations
         WHERE idempotency_key='phase7d:campaign:step:1')<>1
  THEN
    RAISE EXCEPTION 'invocation retry duplicated a logical operation';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_invocations
     WHERE idempotency_key='phase7d:campaign:step:2'
       AND status='refused' AND denial_reason='skill_not_assigned_or_not_executable'
  ) OR NOT EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_invocations
     WHERE idempotency_key='phase7d:conversation:step:2'
       AND status='refused' AND denial_reason='channel_not_permitted'
  ) OR NOT EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_invocations
     WHERE idempotency_key='phase7d:conversation:step:3'
       AND status='refused' AND denial_reason='consent_missing'
  ) OR NOT EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_invocations
     WHERE idempotency_key='phase7d:conversation:step:4'
       AND status='refused' AND denial_reason='runtime_emergency_stop'
  ) THEN
    RAISE EXCEPTION 'model-generated policy refusal evidence is incomplete';
  END IF;
END;
$$;

DO $$
DECLARE
  v_claim record;
BEGIN
  LOOP
    SELECT * INTO v_claim FROM tanaghom.claim_agent_simulation_invocation('simulation-dispatcher');
    EXIT WHEN v_claim.invocation_id IS NULL;
    BEGIN
      PERFORM tanaghom.complete_agent_simulation_invocation(
        v_claim.invocation_id,'succeeded',
        jsonb_build_object(
          'contract_version','phase7.agent-runtime-result.v1',
          'invocation_id',gen_random_uuid(),
          'outcome','succeeded',
          'output_json','{"external_action_count":0}',
          'provider_reference',NULL,
          'prompt_tokens',20,
          'completion_tokens',10,
          'actual_cost',0,
          'error_code',NULL
        ),
        20,10
      );
      RAISE EXCEPTION 'mismatched executor result envelope unexpectedly completed';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='mismatched executor result envelope unexpectedly completed' THEN RAISE; END IF;
    END;
    PERFORM tanaghom.complete_agent_simulation_invocation(
      v_claim.invocation_id,'succeeded',
      jsonb_build_object(
        'contract_version','phase7.agent-runtime-result.v1',
        'invocation_id',v_claim.invocation_id,
        'outcome','succeeded',
        'output_json',jsonb_build_object(
          'simulation',true,'external_action_count',0,
          'skill_code',v_claim.skill_code
        )::text,
        'provider_reference',NULL,
        'prompt_tokens',20,
        'completion_tokens',10,
        'actual_cost',0,
        'error_code',NULL
      ),
      20,10
    );
  END LOOP;
END;
$$;

SELECT tanaghom.finalize_agent_runtime_run(
  (SELECT run_id FROM phase7d_test_ids WHERE label='campaign'),
  'succeeded',
  '{"simulation":true,"external_action_count":0,"language":"en"}',
  'passed'
);
SELECT tanaghom.finalize_agent_runtime_run(
  (SELECT run_id FROM phase7d_test_ids WHERE label='conversation'),
  'succeeded',
  '{"simulation":true,"external_action_count":0,"language":"ar"}',
  'passed'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.organization_agent_jobs
       WHERE status='succeeded' AND scenario_result='passed')<>2
    OR EXISTS (
      SELECT 1 FROM tanaghom.organization_agent_test_scenarios
       WHERE result_state<>'pending'
    )
    OR EXISTS (
      SELECT 1 FROM tanaghom.organization_agent_invocations
       WHERE simulation_only AND actual_cost<>0
    )
    OR EXISTS (
      SELECT 1 FROM tanaghom.organization_agent_runtime_events
       WHERE evidence::text ~* 'password|bearer[[:space:]]|api[_ -]?key'
    )
  THEN
    RAISE EXCEPTION 'bilingual shared-runtime simulation evidence is incomplete or unsafe';
  END IF;
END;
$$;

INSERT INTO phase7d_test_ids(label,job_id)
SELECT 'recovery',job_id FROM tanaghom.queue_organization_agent_job(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  (SELECT version.id
     FROM tanaghom.organization_agent_versions version
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='campaign_runtime_test'),
  '7d000000-0000-4000-8000-000000000001',
  (SELECT scenario.id
     FROM tanaghom.organization_agent_test_scenarios scenario
     JOIN tanaghom.organization_agent_versions version ON version.id=scenario.agent_version_id
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='campaign_runtime_test'
      AND scenario.code='en_provider_failure'),
  NULL,
  '7d100000-0000-4000-8000-000000000003',
  'phase7d:campaign:dependency-recovery',
  'sha256:a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3',
  'scenario',NULL,false,'en',
  '{"brief":"Disposable dependency recovery scenario.","record_type":"campaign"}'
);

INSERT INTO tanaghom.organization_agent_dependency_blocks(
  organization_id,invocation_id,integration_requirement,reason
)
SELECT
  '10000000-0000-4000-8000-000000000001',
  id,
  'postiz_private_gateway',
  'Disposable indeterminate-provider block used to prove fail-closed recovery.'
FROM tanaghom.organization_agent_invocations
WHERE idempotency_key='phase7d:campaign:step:1';

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.claim_organization_agent_job(
    'dependency-blocked-runner'
  ))<>0 THEN
    RAISE EXCEPTION 'active indeterminate-provider block did not stop tenant claims';
  END IF;
END;
$$;

SELECT tanaghom.reconcile_agent_dependency_block(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  (SELECT id FROM tanaghom.organization_agent_dependency_blocks
    WHERE organization_id='10000000-0000-4000-8000-000000000001'
      AND status='active'),
  'Disposable operator verified no provider action occurred and released the blocked tenant.'
);

WITH claimed AS (
  SELECT * FROM tanaghom.claim_organization_agent_job('recovery-runner-first-attempt')
)
UPDATE phase7d_test_ids ids
   SET run_id=claimed.run_id,context=claimed.planner_context
  FROM claimed WHERE ids.job_id=claimed.job_id AND ids.label='recovery';

SELECT tanaghom.fail_agent_runtime_run(
  (SELECT run_id FROM phase7d_test_ids WHERE label='recovery'),
  'dependency.unavailable',
  'Disposable dependency became unavailable after the durable job was accepted.',
  true
);

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.claim_organization_agent_job(
    'recovery-before-backoff'
  ))<>0 THEN
    RAISE EXCEPTION 'retry backoff did not prevent an immediate duplicate claim';
  END IF;
END;
$$;
UPDATE tanaghom.organization_agent_jobs
   SET available_at=statement_timestamp()-interval '1 second'
 WHERE id=(SELECT job_id FROM phase7d_test_ids WHERE label='recovery');

UPDATE phase7d_test_ids SET run_id=NULL,context=NULL WHERE label='recovery';
WITH claimed AS (
  SELECT * FROM tanaghom.claim_organization_agent_job('recovery-runner-second-attempt')
)
UPDATE phase7d_test_ids ids
   SET run_id=claimed.run_id,context=claimed.planner_context
  FROM claimed WHERE ids.job_id=claimed.job_id AND ids.label='recovery';

DO $$
BEGIN
  IF (SELECT run_id FROM phase7d_test_ids WHERE label='recovery') IS NULL
    OR (SELECT attempt FROM tanaghom.organization_agent_jobs
         WHERE id=(SELECT job_id FROM phase7d_test_ids WHERE label='recovery'))<>2
    OR (SELECT run_number FROM tanaghom.organization_agent_runs
         WHERE id=(SELECT run_id FROM phase7d_test_ids WHERE label='recovery'))<>2
  THEN
    RAISE EXCEPTION 'accepted job did not recover through a second durable run';
  END IF;
END;
$$;

SELECT tanaghom.fail_agent_runtime_run(
  (SELECT run_id FROM phase7d_test_ids WHERE label='recovery'),
  'dependency.test_complete',
  'Disposable dependency recovery evidence is complete.',
  false
);

INSERT INTO phase7d_test_ids(label,job_id)
SELECT 'retired-agent',job_id FROM tanaghom.queue_organization_agent_job(
  '10000000-0000-4000-8000-0000000000d2',
  '00000000-0000-4000-8000-0000000000d2',
  (SELECT version.id
     FROM tanaghom.organization_agent_versions version
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='conversation_runtime_test'),
  '7d000000-0000-4000-8000-000000000001',
  (SELECT scenario.id
     FROM tanaghom.organization_agent_test_scenarios scenario
     JOIN tanaghom.organization_agent_versions version ON version.id=scenario.agent_version_id
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='conversation_runtime_test'
      AND scenario.code='ar_emergency_stop'),
  NULL,
  '7d100000-0000-4000-8000-000000000004',
  'phase7d:conversation:retired-agent',
  'sha256:a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4',
  'scenario','whatsapp',true,'ar',
  '{"message":"يجب ألا تبدأ هذه المهمة بعد تعطيل الوكيل.","record_type":"conversation"}'
);
SELECT * FROM tanaghom.transition_organization_agent_version(
  '10000000-0000-4000-8000-0000000000d2',
  '00000000-0000-4000-8000-0000000000d2',
  (SELECT version.id
     FROM tanaghom.organization_agent_versions version
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='conversation_runtime_test'),
  'retire',
  '{"reason":"Disposable immediate-disable claim test"}'
);
DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.claim_organization_agent_job(
    'retired-agent-runner'
  ))<>0 THEN
    RAISE EXCEPTION 'retired agent unexpectedly claimed new work';
  END IF;
END;
$$;

SET ROLE tanaghom_n8n_worker;
DO $$
BEGIN
  BEGIN
    PERFORM tanaghom.claim_organization_agent_job('legacy-n8n-worker');
    RAISE EXCEPTION 'legacy n8n role unexpectedly claimed shared-runtime work';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM tanaghom.organization_agent_invocations;
    RAISE EXCEPTION 'legacy n8n role unexpectedly read the invocation ledger';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SET ROLE tanaghom_skill_read_executor;
DO $$
BEGIN
  BEGIN
    PERFORM tanaghom.claim_agent_action_invocation('read-role');
    RAISE EXCEPTION 'read executor unexpectedly claimed action authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM tanaghom.organization_agent_jobs;
    RAISE EXCEPTION 'read executor unexpectedly received direct job-table access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF has_table_privilege(
      'tanaghom_agent_runtime','tanaghom.organization_agent_jobs','SELECT,INSERT,UPDATE,DELETE'
    )
    OR has_table_privilege(
      'tanaghom_skill_action_executor','tanaghom.organization_agent_invocations',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    OR has_function_privilege(
      'tanaghom_n8n_worker','tanaghom.claim_organization_agent_job(text)','EXECUTE'
    )
    OR has_function_privilege(
      'tanaghom_api',
      'tanaghom.queue_organization_agent_handoff(uuid,uuid,uuid,text,text,text,boolean,jsonb)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'tanaghom_agent_runtime','tanaghom.claim_organization_agent_job(text)','EXECUTE'
    )
    OR NOT has_function_privilege(
      'tanaghom_agent_runtime',
      'tanaghom.queue_organization_agent_handoff(uuid,uuid,uuid,text,text,text,boolean,jsonb)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'tanaghom_skill_proposal_executor',
      'tanaghom.claim_agent_proposal_invocation(text)','EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'shared runtime service-role permissions are not least privileged';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'PASS: two tenants used one shared runtime with progressive disclosure, bilingual simulations, policy denials, idempotency, emergency stop, immutable evidence, and least-privilege executors.' AS result;
