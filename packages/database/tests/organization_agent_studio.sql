\set ON_ERROR_STOP on

BEGIN;

SELECT *
FROM tanaghom.create_sales_knowledge_draft(
  'agent_studio_policy','Agent Studio Sales Policy','policy','en',
  'Approved disposable sales policy for Agent Studio tenant-bound version tests.',
  '[]','customer_entry','disposable-agent-studio-test',
  '00000000-0000-4000-8000-000000000001'
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  (SELECT version.id FROM tanaghom.sales_knowledge_versions version
    JOIN tanaghom.sales_knowledge_sources source ON source.id=version.source_id
   WHERE source.source_key='agent_studio_policy' AND version.version_number=1),
  'review','00000000-0000-4000-8000-000000000001',NULL
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  (SELECT version.id FROM tanaghom.sales_knowledge_versions version
    JOIN tanaghom.sales_knowledge_sources source ON source.id=version.source_id
   WHERE source.source_key='agent_studio_policy' AND version.version_number=1),
  'approve','00000000-0000-4000-8000-000000000001',NULL
);
SELECT * FROM tanaghom.transition_sales_knowledge_version(
  (SELECT version.id FROM tanaghom.sales_knowledge_versions version
    JOIN tanaghom.sales_knowledge_sources source ON source.id=version.source_id
   WHERE source.source_key='agent_studio_policy' AND version.version_number=1),
  'activate','00000000-0000-4000-8000-000000000001',NULL
);

SELECT *
FROM tanaghom.create_organization_agent_draft(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '{
    "code":"lead_qualification",
    "template_code":"lead_qualification",
    "display_name":"Lead Qualification Agent",
    "description":"Qualifies accepted inbound leads and prepares grounded replies without uncontrolled outreach.",
    "objective":"Reduce accepted lead response time while preserving consent and human control.",
    "responsibility":"Review inbound lead context, prepare a grounded proposal, and escalate uncertainty to a supervisor.",
    "tone":"Calm, direct, and evidence-based",
    "brand_profile_key":"brand/tanaghom",
    "languages":["en","ar"],
    "knowledge_keys":["knowledge/agent_studio_policy/v1"],
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
      "business_hours":[
        {"day":1,"start":"09:00","end":"17:00"},
        {"day":2,"start":"09:00","end":"17:00"},
        {"day":3,"start":"09:00","end":"17:00"},
        {"day":4,"start":"09:00","end":"17:00"},
        {"day":5,"start":"09:00","end":"17:00"}
      ],
      "allowed_channels":["whatsapp"],
      "consent_required":true,
      "max_steps":8,
      "max_tool_calls":4,
      "max_retries":2,
      "max_concurrency":3,
      "max_runtime_seconds":300,
      "max_tokens":6000,
      "max_daily_actions":0,
      "max_actions_per_minute":10,
      "max_follow_ups_per_contact":2,
      "monthly_budget":0,
      "allowed_record_types":["contact","conversation"],
      "allowed_action_types":["proposal.create"],
      "approval_actions":["provider.external_write"],
      "approval_roles":["owner","reviewer"],
      "approval_expiry_minutes":60,
      "parameter_bound_approval":true,
      "escalation_conditions":["Escalate when evidence is missing or customer intent is ambiguous."]
    }
  }',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  NULL
);

DO $$
DECLARE
  v_version uuid;
BEGIN
  SELECT version.id INTO v_version
    FROM tanaghom.organization_agent_versions version
    JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
   WHERE definition.code='lead_qualification' AND version.version_number=1;
  IF v_version IS NULL
    OR (SELECT lifecycle_state FROM tanaghom.organization_agent_versions WHERE id=v_version)<>'draft'
    OR (SELECT count(*) FROM tanaghom.organization_agent_skill_bindings WHERE agent_version_id=v_version)<>1
    OR (SELECT count(*) FROM tanaghom.organization_agent_policies WHERE agent_version_id=v_version)<>1
    OR (SELECT count(*) FROM tanaghom.organization_agent_test_scenarios WHERE agent_version_id=v_version)<>14
    OR (SELECT count(*) FROM tanaghom.organization_agent_audit_events WHERE agent_version_id=v_version AND event_type='drafted')<>1
  THEN
    RAISE EXCEPTION 'Agent Studio draft, policy, bilingual scenarios, or audit is incomplete';
  END IF;

  BEGIN
    UPDATE tanaghom.organization_agent_versions
       SET objective='Direct mutation must always fail.'
     WHERE id=v_version;
    RAISE EXCEPTION 'immutable organization agent version unexpectedly changed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='immutable organization agent version unexpectedly changed' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO tanaghom.organization_agent_skill_bindings (
      organization_id,agent_version_id,skill_source,platform_skill_version_id,
      operating_mode,approval_required
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',v_version,'platform',
      '72000000-0000-4000-8000-000000000001','automatic',true
    );
    RAISE EXCEPTION 'automatic Agent Studio mode unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='automatic Agent Studio mode unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;

SELECT *
FROM tanaghom.transition_organization_agent_version(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  (SELECT version.id
     FROM tanaghom.organization_agent_versions version
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='lead_qualification' AND version.version_number=1),
  'validate',
  '{
    "valid":true,
    "validator_version":"tanaghom.organization-agent.v1",
    "checked_boundaries":["closed_contract","no_automatic_mode","no_runtime_activation"],
    "runtime_certified":false
  }'
);

DO $$
DECLARE v_version uuid;
BEGIN
  SELECT version.id INTO v_version
    FROM tanaghom.organization_agent_versions version
    JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
   WHERE definition.code='lead_qualification' AND version.version_number=1;
  IF (SELECT lifecycle_state FROM tanaghom.organization_agent_versions WHERE id=v_version)<>'validated'
    OR (SELECT count(*) FROM tanaghom.organization_agent_audit_events
         WHERE agent_version_id=v_version AND event_type='validated')<>1
  THEN
    RAISE EXCEPTION 'Agent Studio validation evidence is incomplete';
  END IF;

  BEGIN
    PERFORM tanaghom.transition_organization_agent_version(
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      v_version,'begin_simulation',NULL
    );
    RAISE EXCEPTION 'uncertified simulation promotion unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='uncertified simulation promotion unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;

SELECT *
FROM tanaghom.create_organization_agent_draft(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '{
    "code":"lead_qualification",
    "template_code":"lead_qualification",
    "display_name":"Lead Qualification Agent v2",
    "description":"Creates the next immutable lead-qualification configuration without changing the validated version.",
    "objective":"Reduce accepted lead response time while preserving consent and human control.",
    "responsibility":"Review inbound lead context, prepare a grounded proposal, and escalate uncertainty to a supervisor.",
    "tone":"Calm, direct, and evidence-based",
    "brand_profile_key":"brand/tanaghom",
    "languages":["en","ar"],
    "knowledge_keys":["knowledge/agent_studio_policy/v1"],
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
      "max_steps":8,
      "max_tool_calls":4,
      "max_retries":2,
      "max_concurrency":3,
      "max_runtime_seconds":300,
      "max_tokens":6000,
      "max_daily_actions":0,
      "max_actions_per_minute":10,
      "max_follow_ups_per_contact":2,
      "monthly_budget":0,
      "allowed_record_types":["contact","conversation"],
      "allowed_action_types":["proposal.create"],
      "approval_actions":["provider.external_write"],
      "approval_roles":["owner","reviewer"],
      "approval_expiry_minutes":60,
      "parameter_bound_approval":true,
      "escalation_conditions":["Escalate when evidence is missing or customer intent is ambiguous."]
    }
  }',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  (SELECT version.id
     FROM tanaghom.organization_agent_versions version
     JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='lead_qualification' AND version.version_number=1)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.organization_agent_versions version
    JOIN tanaghom.organization_agent_definitions definition ON definition.id=version.agent_id
    WHERE definition.code='lead_qualification'
      AND version.version_number=2
      AND version.lifecycle_state='draft'
      AND version.supersedes_version_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Agent Studio immutable version lineage was not created';
  END IF;
END;
$$;

INSERT INTO tanaghom.organizations(id,slug,name)
VALUES ('10000000-0000-4000-8000-000000000098','disposable-agent-tenant','Disposable Agent Tenant');
INSERT INTO tanaghom.app_users(id,email,display_name,kind,role,auth_subject,accepted_at,organization_id)
VALUES (
  '00000000-0000-4000-8000-000000000098','agent-owner@example.test','Agent Owner',
  'human','owner','90000000-0000-4000-8000-000000000098',now(),
  '10000000-0000-4000-8000-000000000098'
);

DO $$
BEGIN
  BEGIN
    PERFORM tanaghom.transition_organization_agent_version(
      '10000000-0000-4000-8000-000000000098',
      '00000000-0000-4000-8000-000000000098',
      (SELECT id FROM tanaghom.organization_agent_versions ORDER BY created_at LIMIT 1),
      'retire',NULL
    );
    RAISE EXCEPTION 'cross-tenant agent transition unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-tenant agent transition unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;

SET ROLE tanaghom_api;
SELECT count(*) FROM tanaghom.organization_agent_versions;
DO $$
BEGIN
  BEGIN
    INSERT INTO tanaghom.organization_agent_audit_events(
      organization_id,agent_id,agent_version_id,event_type,actor_id,provenance
    ) SELECT organization_id,agent_id,id,'validated',created_by,'{}'
        FROM tanaghom.organization_agent_versions LIMIT 1;
    RAISE EXCEPTION 'API direct Agent Studio write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SET ROLE tanaghom_n8n_worker;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM tanaghom.organization_agent_versions;
    RAISE EXCEPTION 'n8n Agent Studio read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM tanaghom.transition_organization_agent_version(
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '99999999-9999-4999-8999-999999999999','retire',NULL
    );
    RAISE EXCEPTION 'n8n Agent Studio transition unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT has_table_privilege('tanaghom_api','tanaghom.organization_agent_versions','SELECT')
    OR NOT has_table_privilege('tanaghom_readonly','tanaghom.organization_agent_audit_events','SELECT')
    OR has_table_privilege('tanaghom_api','tanaghom.organization_agent_versions','INSERT,UPDATE,DELETE')
    OR has_table_privilege('tanaghom_n8n_worker','tanaghom.organization_agent_versions','SELECT,INSERT,UPDATE,DELETE')
    OR has_function_privilege(
      'tanaghom_n8n_worker',
      'tanaghom.create_organization_agent_draft(uuid,uuid,jsonb,text,uuid)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'Agent Studio least-privilege grants are incorrect';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'PASS: Agent Studio tenant isolation, immutable versioning, bounded modes, lifecycle gating, audit, and role boundaries are enforced.' AS result;
