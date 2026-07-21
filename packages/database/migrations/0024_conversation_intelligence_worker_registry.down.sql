BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.agent_workflow_registry
       WHERE code = 'conversation_intelligence_worker'
         AND runtime_state = 'available_not_imported'
         AND trigger_state = 'disabled') <> 1 THEN
    RAISE EXCEPTION 'conversation intelligence worker must be absent from runtime before rolling back 0024';
  END IF;
END;
$$;

DELETE FROM tanaghom.agent_workflow_registry
WHERE code = 'conversation_intelligence_worker';

DELETE FROM public.schema_migrations
WHERE version = '0024_conversation_intelligence_worker_registry';

COMMIT;
