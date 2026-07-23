BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tanaghom.skill_definitions WHERE organization_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM tanaghom.agent_skill_bindings WHERE organization_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM tanaghom.skill_references WHERE organization_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM tanaghom.skill_audit_events WHERE organization_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'cannot roll back 0026 while organization-owned skill data or bindings exist';
  END IF;
  IF (SELECT count(*) FROM tanaghom.skill_definitions)<>8
    OR (SELECT count(*) FROM tanaghom.skill_versions)<>8
    OR (SELECT count(*) FROM tanaghom.agent_skill_bindings)<>8
    OR (SELECT count(*) FROM tanaghom.skill_references)<>24
    OR (SELECT count(*) FROM tanaghom.skill_audit_events)<>8
  THEN
    RAISE EXCEPTION 'cannot roll back 0026 after the platform skill registry changed';
  END IF;
END;
$$;

DROP TABLE tanaghom.skill_audit_events;
DROP TABLE tanaghom.skill_references;
DROP TABLE tanaghom.agent_skill_bindings;
DROP TABLE tanaghom.skill_versions;
DROP TABLE tanaghom.skill_definitions;

DROP FUNCTION tanaghom.enforce_skill_audit_integrity();
DROP FUNCTION tanaghom.enforce_skill_reference_integrity();
DROP FUNCTION tanaghom.enforce_agent_skill_binding_integrity();
DROP FUNCTION tanaghom.enforce_skill_version_integrity();
DROP FUNCTION tanaghom.skill_schema_ref_is_safe(text);
DROP FUNCTION tanaghom.skill_permission_manifest_is_safe(jsonb);

DELETE FROM public.schema_migrations
WHERE version='0026_skill_registry';

COMMIT;
