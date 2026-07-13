BEGIN;

REVOKE EXECUTE ON FUNCTION tanaghom.claim_postiz_draft_job() FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.maybe_queue_automatic_postiz_draft(uuid, uuid, boolean) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.set_postiz_automation_mode(uuid, text, boolean) FROM tanaghom_api;
REVOKE SELECT ON tanaghom.postiz_automation_status FROM tanaghom_api, tanaghom_readonly;

DROP FUNCTION tanaghom.claim_postiz_draft_job();
DROP FUNCTION tanaghom.maybe_queue_automatic_postiz_draft(uuid, uuid, boolean);
DROP TRIGGER external_operations_postiz_automation_gate ON tanaghom.external_operations;
DROP TRIGGER agent_jobs_postiz_automation_gate ON tanaghom.agent_jobs;
DROP FUNCTION tanaghom.enforce_postiz_automation_gate();
DROP FUNCTION tanaghom.set_postiz_automation_mode(uuid, text, boolean);
DROP VIEW tanaghom.postiz_automation_status;
DROP TRIGGER organizations_create_automation_policy ON tanaghom.organizations;
DROP FUNCTION tanaghom.create_organization_automation_policy();
DROP TABLE tanaghom.automation_platform_controls;
DROP TABLE tanaghom.organization_automation_policies;

DELETE FROM public.schema_migrations
WHERE version = '0009_postiz_automation_controls';

COMMIT;
