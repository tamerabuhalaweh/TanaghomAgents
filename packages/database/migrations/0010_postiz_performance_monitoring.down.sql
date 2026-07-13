BEGIN;

REVOKE EXECUTE ON FUNCTION tanaghom.record_postiz_performance_failure(uuid, text, text, integer, integer) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.complete_postiz_performance_sync(uuid, jsonb) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.prepare_postiz_performance_sync(uuid) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.claim_postiz_performance_job() FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.queue_postiz_performance_sync(uuid, uuid, integer) FROM tanaghom_api;
REVOKE SELECT ON tanaghom.post_metric_observations, tanaghom.post_performance_sync_state,
  tanaghom.lead_attribution_records FROM tanaghom_api, tanaghom_readonly;

DROP FUNCTION tanaghom.record_postiz_performance_failure(uuid, text, text, integer, integer);
DROP FUNCTION tanaghom.complete_postiz_performance_sync(uuid, jsonb);
DROP FUNCTION tanaghom.prepare_postiz_performance_sync(uuid);
DROP FUNCTION tanaghom.claim_postiz_performance_job();
DROP FUNCTION tanaghom.queue_postiz_performance_sync(uuid, uuid, integer);
DROP INDEX tanaghom.agent_jobs_postiz_performance_active_uidx;
DROP TABLE tanaghom.lead_attribution_records;
DROP TABLE tanaghom.post_performance_sync_state;
DROP TABLE tanaghom.post_metric_observations;
DROP FUNCTION tanaghom.enforce_phase4h_organization_links();

DELETE FROM public.schema_migrations
WHERE version = '0010_postiz_performance_monitoring';

COMMIT;
