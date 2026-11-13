BEGIN;

DROP TRIGGER IF EXISTS assign_agent_action_organization ON tanaghom.agent_actions_log;
DROP FUNCTION IF EXISTS tanaghom.assign_agent_action_organization();
DROP INDEX IF EXISTS tanaghom.agent_actions_log_organization_time_idx;

ALTER TABLE tanaghom.agent_actions_log
  DROP COLUMN IF EXISTS organization_id;

DELETE FROM public.schema_migrations WHERE version = '0051_agent_audit_organization';

COMMIT;
