\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.agents
       WHERE code IN ('campaign_strategist','content_producer','publisher_monitor','sales_crm')) <> 4 THEN
    RAISE EXCEPTION 'all four business runtime agents are required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tanaghom.agents
     WHERE code IN ('publisher_monitor','sales_crm')
       AND (status='disabled' OR length(trim(description))<20)
  ) THEN
    RAISE EXCEPTION 'publisher or sales runtime agent is unavailable or undocumented';
  END IF;
  IF (SELECT count(*) FROM tanaghom.agents WHERE code='publisher_monitor')<>1
     OR (SELECT count(*) FROM tanaghom.agents WHERE code='sales_crm')<>1 THEN
    RAISE EXCEPTION 'publisher and sales runtime identities must be unique';
  END IF;
END $$;

SELECT 'PASS: four unique enabled business runtime agents are present.' AS result;
