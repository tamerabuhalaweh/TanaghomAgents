BEGIN;

REVOKE EXECUTE ON FUNCTION tanaghom.record_ghl_contact_failure(uuid, text, text, integer, integer) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.complete_ghl_contact_upsert(uuid, jsonb) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.prepare_ghl_contact_upsert(uuid) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.claim_ghl_contact_job() FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.queue_ghl_contact_upsert(uuid, uuid) FROM tanaghom_api;
REVOKE SELECT ON tanaghom.organization_crm_policies, tanaghom.ghl_contact_sync_state
  FROM tanaghom_api, tanaghom_readonly;

DROP FUNCTION tanaghom.record_ghl_contact_failure(uuid, text, text, integer, integer);
DROP FUNCTION tanaghom.complete_ghl_contact_upsert(uuid, jsonb);
DROP FUNCTION tanaghom.prepare_ghl_contact_upsert(uuid);
DROP FUNCTION tanaghom.claim_ghl_contact_job();
DROP FUNCTION tanaghom.queue_ghl_contact_upsert(uuid, uuid);
DROP INDEX tanaghom.agent_jobs_ghl_contact_active_uidx;
DROP TABLE tanaghom.ghl_contact_sync_state;
DROP TRIGGER organization_create_crm_policy ON tanaghom.organizations;
DROP FUNCTION tanaghom.create_organization_crm_policy();
DROP TABLE tanaghom.organization_crm_policies;
DROP FUNCTION tanaghom.enforce_ghl_sync_organization();

DELETE FROM tanaghom.automation_platform_controls WHERE provider = 'ghl';
ALTER TABLE tanaghom.automation_platform_controls
  DROP CONSTRAINT automation_platform_controls_provider_check,
  ADD CONSTRAINT automation_platform_controls_provider_check CHECK (provider = 'postiz');

DELETE FROM public.schema_migrations WHERE version = '0011_ghl_contact_sync';

COMMIT;
