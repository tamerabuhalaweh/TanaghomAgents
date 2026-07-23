\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.skill_definitions)<>8
    OR (SELECT count(*) FROM tanaghom.skill_versions WHERE lifecycle_state='published')<>8
    OR (SELECT count(*) FROM tanaghom.agent_skill_bindings WHERE binding_state='active')<>8
    OR (SELECT count(*) FROM tanaghom.skill_references)<>24
    OR (SELECT count(*) FROM tanaghom.skill_audit_events WHERE event_type='published')<>8
  THEN
    RAISE EXCEPTION 'Phase 7A must seed eight published platform skills and immutable evidence';
  END IF;
  IF EXISTS (
    SELECT worker.code
      FROM tanaghom.agent_workflow_registry worker
      LEFT JOIN tanaghom.agent_skill_bindings binding ON binding.worker_code=worker.code
     GROUP BY worker.code HAVING count(binding.id)<>1
  ) THEN
    RAISE EXCEPTION 'every reviewed worker must reconcile to exactly one pinned skill version';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM tanaghom.agent_skill_bindings binding
      JOIN tanaghom.skill_versions version ON version.id=binding.skill_version_id
      JOIN tanaghom.agent_workflow_registry worker ON worker.code=binding.worker_code
     WHERE version.executor_type<>'pinned_n8n_workflow'
        OR version.executor_ref<>worker.code
        OR version.executor_version<>worker.workflow_version
        OR binding.role_code<>worker.role_code
  ) THEN
    RAISE EXCEPTION 'skill executor or role binding drifted from the worker registry';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tanaghom.skill_versions
     WHERE NOT tanaghom.skill_permission_manifest_is_safe(permission_manifest)
       OR NOT tanaghom.skill_schema_ref_is_safe(input_schema_ref)
       OR NOT tanaghom.skill_schema_ref_is_safe(output_schema_ref)
       OR content_hash !~ '^[a-f0-9]{64}$'
       OR tool_schema_hash !~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'published skills contain an unsafe manifest, schema reference, or checksum';
  END IF;
  IF (SELECT count(*) FROM tanaghom.agent_workflow_registry)<>8
    OR (SELECT count(*) FROM tanaghom.agent_role_registry)<>4
  THEN
    RAISE EXCEPTION 'Phase 7A changed the authoritative agent inventory';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE tanaghom.skill_versions
       SET instructions='This mutation must be rejected for an already published skill version.'
     WHERE id='72000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'published skill mutation unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='published skill mutation unexpectedly succeeded' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE tanaghom.agent_skill_bindings SET binding_state='retired'
     WHERE id='73000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'immutable binding update unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='immutable binding update unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO tanaghom.skill_definitions
  (id,organization_id,owner_scope,code,name,description,skill_class)
VALUES
  ('71000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000001',
   'organization','disposable_registry_test','Disposable Registry Test',
   'Disposable organization skill used only for registry constraint verification.','proposal');

DO $$
BEGIN
  BEGIN
    INSERT INTO tanaghom.skill_versions
      (id,skill_id,version_number,lifecycle_state,instructions,input_schema_ref,output_schema_ref,
       risk_class,side_effect_class,permission_manifest,integration_requirements,
       executor_type,executor_ref,executor_version,package_path,content_hash,tool_schema_hash,
       audit_provenance)
    VALUES
      ('72000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000101',1,'draft',
       'Reject broad wildcard permissions before a skill version can be validated.',
       'packages/contracts/schemas/phase3/strategist-job.v1.schema.json',
       'packages/contracts/schemas/phase3/strategist-output.v1.schema.json',
       'medium','proposal_only',
       '{"data_domains":["campaign_brief"],"integrations":[],"channels":[],"operations":["*"]}',
       '{}','pinned_n8n_workflow','campaign_strategy_generator','v1',
       'skills/platform/create-campaign-strategy/SKILL.md',
       repeat('a',64),repeat('b',64),'{"source":"disposable-test"}');
    RAISE EXCEPTION 'wildcard permission unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO tanaghom.skill_versions
      (id,skill_id,version_number,lifecycle_state,instructions,input_schema_ref,output_schema_ref,
       risk_class,side_effect_class,permission_manifest,integration_requirements,
       executor_type,executor_ref,executor_version,package_path,content_hash,tool_schema_hash,
       audit_provenance)
    VALUES
      ('72000000-0000-4000-8000-000000000102','71000000-0000-4000-8000-000000000101',1,'draft',
       'Reject an executor that is not present in the reviewed worker registry.',
       'packages/contracts/schemas/phase3/strategist-job.v1.schema.json',
       'packages/contracts/schemas/phase3/strategist-output.v1.schema.json',
       'medium','proposal_only',
       '{"data_domains":["campaign_brief"],"integrations":[],"channels":[],"operations":["campaign.strategy.propose"]}',
       '{}','pinned_n8n_workflow','unknown_worker','v1',
       'skills/platform/create-campaign-strategy/SKILL.md',
       repeat('a',64),repeat('b',64),'{"source":"disposable-test"}');
    RAISE EXCEPTION 'unknown executor unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='unknown executor unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO tanaghom.skill_versions
  (id,skill_id,version_number,lifecycle_state,instructions,input_schema_ref,output_schema_ref,
   risk_class,side_effect_class,permission_manifest,integration_requirements,
   executor_type,executor_ref,executor_version,package_path,content_hash,tool_schema_hash,
   audit_provenance)
VALUES
  ('72000000-0000-4000-8000-000000000103','71000000-0000-4000-8000-000000000101',1,'draft',
   'Create a valid disposable draft to prove tenant and lifecycle binding enforcement.',
   'packages/contracts/schemas/phase3/strategist-job.v1.schema.json',
   'packages/contracts/schemas/phase3/strategist-output.v1.schema.json',
   'medium','proposal_only',
   '{"data_domains":["campaign_brief"],"integrations":[],"channels":[],"operations":["campaign.strategy.propose"]}',
   '{}','pinned_n8n_workflow','campaign_strategy_generator','v1',
   'skills/platform/create-campaign-strategy/SKILL.md',
   repeat('a',64),repeat('b',64),'{"source":"disposable-test"}');

DO $$
BEGIN
  BEGIN
    INSERT INTO tanaghom.agent_skill_bindings
      (organization_id,role_code,worker_code,skill_version_id,audit_provenance)
    VALUES
      (NULL,'campaign_strategist','campaign_strategy_generator',
       '72000000-0000-4000-8000-000000000103','{"source":"disposable-test"}');
    RAISE EXCEPTION 'cross-tenant binding unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-tenant binding unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;

DELETE FROM tanaghom.skill_versions WHERE id='72000000-0000-4000-8000-000000000103';
DELETE FROM tanaghom.skill_definitions WHERE id='71000000-0000-4000-8000-000000000101';

SET ROLE tanaghom_api;
SELECT count(*) FROM tanaghom.skill_definitions;
DO $$
BEGIN
  BEGIN
    INSERT INTO tanaghom.skill_audit_events
      (skill_id,skill_version_id,event_type,actor_kind,provenance)
    VALUES
      ('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
       'published','platform_operator','{}');
    RAISE EXCEPTION 'API registry write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SET ROLE tanaghom_n8n_worker;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM tanaghom.skill_definitions;
    RAISE EXCEPTION 'n8n registry read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO tanaghom.skill_audit_events
      (skill_id,event_type,actor_kind,provenance)
    VALUES ('71000000-0000-4000-8000-000000000001','bound','migration','{}');
    RAISE EXCEPTION 'n8n registry write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT has_table_privilege('tanaghom_api','tanaghom.skill_definitions','SELECT')
    OR NOT has_table_privilege('tanaghom_readonly','tanaghom.skill_versions','SELECT')
    OR has_table_privilege('tanaghom_api','tanaghom.skill_versions','INSERT,UPDATE,DELETE')
    OR has_table_privilege('tanaghom_n8n_worker','tanaghom.skill_versions','SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('tanaghom_conversation_worker','tanaghom.skill_versions','SELECT,INSERT,UPDATE,DELETE')
  THEN
    RAISE EXCEPTION 'Skill Registry least-privilege grants are incorrect';
  END IF;
END;
$$;

SELECT 'PASS: Skill Registry reconciliation, immutability, tenant isolation, and role boundaries are enforced.' AS result;
