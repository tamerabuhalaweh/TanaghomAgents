BEGIN;
DROP TRIGGER agent_workflow_registry_updated_at ON tanaghom.agent_workflow_registry;
DROP TRIGGER agent_role_registry_updated_at ON tanaghom.agent_role_registry;
DROP TABLE tanaghom.agent_workflow_registry;
DROP TABLE tanaghom.agent_role_registry;
DELETE FROM public.schema_migrations WHERE version='0022_agent_registry';
COMMIT;
