BEGIN;

REVOKE EXECUTE ON FUNCTION tanaghom.claim_agent_job(text, text[]) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.persist_strategy_result(uuid, jsonb, text, text) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.persist_content_result(uuid, jsonb, text, text) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.record_agent_job_failure(uuid, text, text, integer) FROM tanaghom_n8n_worker;
REVOKE EXECUTE ON FUNCTION tanaghom.complete_content_job(uuid) FROM tanaghom_n8n_worker;

DROP FUNCTION tanaghom.complete_content_job(uuid);
DROP FUNCTION tanaghom.record_agent_job_failure(uuid, text, text, integer);
DROP FUNCTION tanaghom.persist_content_result(uuid, jsonb, text, text);
DROP FUNCTION tanaghom.persist_strategy_result(uuid, jsonb, text, text);
DROP FUNCTION tanaghom.claim_agent_job(text, text[]);

DELETE FROM public.schema_migrations
WHERE version = '0005_controlled_worker_functions';

COMMIT;
