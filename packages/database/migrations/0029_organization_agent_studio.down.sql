BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tanaghom.organization_agent_definitions)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_versions)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_skill_bindings)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_integration_bindings)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_test_scenarios)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_agent_audit_events)
  THEN
    RAISE EXCEPTION 'cannot roll back 0029 while organization Agent Studio data exists';
  END IF;
END;
$$;

DROP FUNCTION tanaghom.transition_organization_agent_version(uuid,uuid,uuid,text,jsonb);
DROP FUNCTION tanaghom.create_organization_agent_draft(uuid,uuid,jsonb,text,uuid);
DROP TRIGGER organization_agent_audit_integrity ON tanaghom.organization_agent_audit_events;
DROP TRIGGER organization_agent_test_scenarios_integrity ON tanaghom.organization_agent_test_scenarios;
DROP TRIGGER organization_agent_policies_integrity ON tanaghom.organization_agent_policies;
DROP TRIGGER organization_agent_integration_bindings_integrity ON tanaghom.organization_agent_integration_bindings;
DROP TRIGGER organization_agent_skill_bindings_integrity ON tanaghom.organization_agent_skill_bindings;
DROP TRIGGER organization_agent_versions_integrity ON tanaghom.organization_agent_versions;
DROP TRIGGER organization_agent_definitions_integrity ON tanaghom.organization_agent_definitions;
DROP TABLE tanaghom.organization_agent_audit_events;
DROP TABLE tanaghom.organization_agent_test_scenarios;
DROP TABLE tanaghom.organization_agent_policies;
DROP TABLE tanaghom.organization_agent_integration_bindings;
DROP TABLE tanaghom.organization_agent_skill_bindings;
DROP TABLE tanaghom.organization_agent_versions;
DROP TABLE tanaghom.organization_agent_definitions;
DROP TABLE tanaghom.agent_studio_templates;
DROP FUNCTION tanaghom.enforce_organization_agent_audit_integrity();
DROP FUNCTION tanaghom.enforce_organization_agent_child_integrity();
DROP FUNCTION tanaghom.enforce_organization_agent_version_integrity();
DROP FUNCTION tanaghom.enforce_organization_agent_definition_integrity();
DROP FUNCTION tanaghom.organization_agent_text_is_safe(text);
DROP FUNCTION tanaghom.assert_organization_agent_owner(uuid,uuid);

DELETE FROM public.schema_migrations WHERE version='0029_organization_agent_studio';

COMMIT;
