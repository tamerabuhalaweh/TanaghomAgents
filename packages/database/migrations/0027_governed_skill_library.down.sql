BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tanaghom.organization_skill_definitions)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_skill_versions)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_skill_references)
    OR EXISTS (SELECT 1 FROM tanaghom.organization_skill_audit_events)
  THEN
    RAISE EXCEPTION 'cannot roll back 0027 while organization Skill Library data exists';
  END IF;
END;
$$;

DROP FUNCTION tanaghom.record_organization_skill_export(uuid,uuid,uuid);
DROP FUNCTION tanaghom.transition_organization_skill_version(uuid,uuid,uuid,text,jsonb);
DROP FUNCTION tanaghom.create_organization_skill_draft(uuid,uuid,text,text,text,text,text,text,jsonb,text[],text[],text,text[],text,jsonb,uuid);
DROP TABLE tanaghom.organization_skill_audit_events;
DROP TABLE tanaghom.organization_skill_references;
DROP TRIGGER organization_skill_versions_integrity ON tanaghom.organization_skill_versions;
DROP TRIGGER organization_skill_definitions_integrity ON tanaghom.organization_skill_definitions;
DROP TABLE tanaghom.organization_skill_versions;
DROP TABLE tanaghom.organization_skill_definitions;
DROP FUNCTION tanaghom.enforce_organization_skill_audit_integrity();
DROP FUNCTION tanaghom.enforce_organization_skill_reference_integrity();
DROP FUNCTION tanaghom.enforce_organization_skill_version_integrity();
DROP FUNCTION tanaghom.enforce_organization_skill_definition_integrity();
DROP FUNCTION tanaghom.organization_skill_text_is_safe(text);
DROP FUNCTION tanaghom.assert_organization_skill_owner(uuid,uuid);

DELETE FROM public.schema_migrations WHERE version='0027_governed_skill_library';

COMMIT;
