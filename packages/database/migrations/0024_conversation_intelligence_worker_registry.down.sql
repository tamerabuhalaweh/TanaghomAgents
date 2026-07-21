BEGIN;

DELETE FROM tanaghom.agent_workflow_registry
WHERE code = 'conversation_intelligence_worker';

DELETE FROM public.schema_migrations
WHERE version = '0024_conversation_intelligence_worker_registry';

COMMIT;
