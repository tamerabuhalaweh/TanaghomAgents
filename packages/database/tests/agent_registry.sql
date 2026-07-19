\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.agent_role_registry) <> 4 THEN
    RAISE EXCEPTION 'agent registry must expose four business roles';
  END IF;
  IF (SELECT count(*) FROM tanaghom.agent_workflow_registry) <> 7 THEN
    RAISE EXCEPTION 'agent registry must expose seven specialized workflow workers';
  END IF;
  IF EXISTS (
    SELECT role.code
      FROM tanaghom.agent_role_registry role
      LEFT JOIN tanaghom.agent_workflow_registry worker ON worker.role_code=role.code
     GROUP BY role.code HAVING count(worker.code)=0
  ) THEN
    RAISE EXCEPTION 'every business role must own at least one specialized worker';
  END IF;
  IF (SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='imported_inactive') <> 4
    OR (SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='available_not_imported') <> 3
    OR EXISTS (SELECT 1 FROM tanaghom.agent_workflow_registry WHERE runtime_state='active')
  THEN
    RAISE EXCEPTION 'reviewed production runtime snapshot is inconsistent';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tanaghom.agent_workflow_registry
     WHERE release_state<>'available' OR runtime_verified_at IS NULL
       OR runtime_evidence<>'production-audit-after-pr-83'
  ) THEN
    RAISE EXCEPTION 'workflow release or runtime evidence is incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tanaghom.agent_workflow_registry WHERE 'content.postiz.draft'=ANY(job_types))
    OR NOT EXISTS (SELECT 1 FROM tanaghom.agent_workflow_registry WHERE 'lead.ghl.contact_upsert'=ANY(job_types))
  THEN
    RAISE EXCEPTION 'registry job types drifted from controlled database queues';
  END IF;
  IF NOT has_table_privilege('tanaghom_api','tanaghom.agent_role_registry','SELECT')
    OR NOT has_table_privilege('tanaghom_api','tanaghom.agent_workflow_registry','SELECT')
    OR NOT has_table_privilege('tanaghom_readonly','tanaghom.agent_workflow_registry','SELECT')
  THEN
    RAISE EXCEPTION 'API and readonly roles require registry visibility';
  END IF;
  IF has_table_privilege('tanaghom_api','tanaghom.agent_workflow_registry','INSERT,UPDATE,DELETE')
    OR has_table_privilege('tanaghom_n8n_worker','tanaghom.agent_workflow_registry','SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('tanaghom_conversation_worker','tanaghom.agent_workflow_registry','SELECT,INSERT,UPDATE,DELETE')
  THEN
    RAISE EXCEPTION 'runtime workers or API received registry mutation authority';
  END IF;
END $$;

SELECT 'PASS: agent registry inventory and least privilege are enforced.' AS result;
