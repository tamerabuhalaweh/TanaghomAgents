BEGIN;

REVOKE EXECUTE ON FUNCTION tanaghom.recover_stale_ghl_inbound_event_jobs(integer) FROM tanaghom_conversation_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.record_ghl_inbound_event_failure(uuid, text, text, integer) FROM tanaghom_conversation_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.complete_ghl_inbound_event(uuid, jsonb) FROM tanaghom_conversation_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.claim_ghl_inbound_event_job() FROM tanaghom_conversation_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.replay_ghl_inbound_event(uuid, uuid) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.accept_ghl_inbound_event(jsonb, text) FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.record_ghl_webhook_rejection(text, text) FROM tanaghom_api;
REVOKE SELECT ON tanaghom.ghl_inbound_event_metrics FROM tanaghom_api, tanaghom_readonly;
REVOKE SELECT ON tanaghom.ghl_inbound_events FROM tanaghom_api;

DROP FUNCTION tanaghom.replay_ghl_inbound_event(uuid, uuid);
DROP FUNCTION tanaghom.recover_stale_ghl_inbound_event_jobs(integer);
DROP FUNCTION tanaghom.record_ghl_inbound_event_failure(uuid, text, text, integer);
DROP FUNCTION tanaghom.complete_ghl_inbound_event(uuid, jsonb);
DROP FUNCTION tanaghom.claim_ghl_inbound_event_job();
DROP FUNCTION tanaghom.accept_ghl_inbound_event(jsonb, text);
DROP FUNCTION tanaghom.record_ghl_webhook_rejection(text, text);
DROP VIEW tanaghom.ghl_inbound_event_metrics;
DROP INDEX tanaghom.agent_jobs_ghl_inbound_event_uidx;
DROP TABLE tanaghom.ghl_inbound_events;
DROP TABLE tanaghom.ghl_webhook_rejection_metrics;

ALTER TABLE tanaghom.organization_crm_policies
  DROP COLUMN conversation_processing_mode;

REVOKE USAGE ON SCHEMA tanaghom FROM tanaghom_conversation_worker;
DROP ROLE tanaghom_conversation_worker;

DELETE FROM public.schema_migrations WHERE version = '0012_ghl_inbound_event_inbox';

COMMIT;
