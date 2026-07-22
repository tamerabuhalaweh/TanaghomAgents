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
    RAISE EXCEPTION 'runtime agent reconciliation found a fixed identity conflict';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tanaghom.agents
     WHERE code='campaign_strategist'
       AND (name<>'Campaign Strategist' OR status='disabled')
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.agents
     WHERE code='content_producer'
       AND (name<>'Content Producer' OR status='disabled')
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.agents
     WHERE code='publisher_monitor'
       AND (name<>'Publisher & Performance Monitor' OR status='disabled')
  ) OR EXISTS (
    SELECT 1 FROM tanaghom.agents
     WHERE code='sales_crm'
       AND (name<>'Sales & CRM Agent' OR status='disabled')
  ) THEN
    RAISE EXCEPTION 'runtime agent reconciliation found an incompatible existing agent';
  END IF;
END;
$$;

INSERT INTO tanaghom.agents (id,code,name,description,status)
SELECT
  '10000000-0000-4000-8000-000000000001',
  'campaign_strategist',
  'Campaign Strategist',
  'Builds structured campaign strategy.',
  'idle'
WHERE NOT EXISTS (SELECT 1 FROM tanaghom.agents WHERE code='campaign_strategist');

INSERT INTO tanaghom.agents (id,code,name,description,status)
SELECT
  '10000000-0000-4000-8000-000000000002',
  'content_producer',
  'Content Producer',
  'Creates content drafts for approval.',
  'idle'
WHERE NOT EXISTS (SELECT 1 FROM tanaghom.agents WHERE code='content_producer');

INSERT INTO tanaghom.agents (id,code,name,description,status)
SELECT
  '10000000-0000-4000-8000-000000000003',
  'publisher_monitor',
  'Publisher & Performance Monitor',
  'Publishes approved content and records performance.',
  'idle'
WHERE NOT EXISTS (SELECT 1 FROM tanaghom.agents WHERE code='publisher_monitor');

INSERT INTO tanaghom.agents (id,code,name,description,status)
SELECT
  '10000000-0000-4000-8000-000000000004',
  'sales_crm',
  'Sales & CRM Agent',
  'Runs bounded lead and sales workflows.',
  'idle'
WHERE NOT EXISTS (SELECT 1 FROM tanaghom.agents WHERE code='sales_crm');

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.agents
       WHERE code IN ('campaign_strategist','content_producer','publisher_monitor','sales_crm')) <> 4
     OR (SELECT count(*) FROM tanaghom.agents
          WHERE code IN ('publisher_monitor','sales_crm') AND status<>'disabled') <> 2 THEN
    RAISE EXCEPTION 'four enabled business runtime agents are required';
  END IF;
END;
$$;

INSERT INTO public.schema_migrations(version)
VALUES ('0025_runtime_agent_reconciliation');

COMMIT;
