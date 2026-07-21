BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tanaghom.agents
     WHERE id='10000000-0000-4000-8000-000000000001'
       AND code<>'campaign_strategist'
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.agents
     WHERE id='10000000-0000-4000-8000-000000000002'
       AND code<>'content_producer'
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.agents
     WHERE id='10000000-0000-4000-8000-000000000003'
       AND code<>'publisher_monitor'
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.agents
     WHERE id='10000000-0000-4000-8000-000000000004'
       AND code<>'sales_crm'
  ) THEN
    RAISE EXCEPTION 'runtime agent rollback found a fixed identity conflict';
  END IF;
END;
$$;

DELETE FROM tanaghom.agents agent
WHERE agent.id IN (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004'
)
AND NOT EXISTS (
  SELECT 1 FROM tanaghom.agent_jobs job WHERE job.agent_id=agent.id
);

DELETE FROM public.schema_migrations
WHERE version='0025_runtime_agent_reconciliation';

COMMIT;
