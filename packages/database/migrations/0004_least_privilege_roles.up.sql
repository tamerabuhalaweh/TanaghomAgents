BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tanaghom_api') THEN
    CREATE ROLE tanaghom_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tanaghom_n8n_worker') THEN
    CREATE ROLE tanaghom_n8n_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tanaghom_readonly') THEN
    CREATE ROLE tanaghom_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END;
$$;

REVOKE ALL ON SCHEMA tanaghom FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA tanaghom FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tanaghom FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA tanaghom REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA tanaghom REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA tanaghom REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA tanaghom TO tanaghom_api, tanaghom_n8n_worker, tanaghom_readonly;

GRANT SELECT ON ALL TABLES IN SCHEMA tanaghom TO tanaghom_api, tanaghom_readonly;
GRANT INSERT ON
  tanaghom.content_approvals,
  tanaghom.agent_actions_log,
  tanaghom.outbox_events,
  tanaghom.api_idempotency_keys
TO tanaghom_api;
GRANT UPDATE (status) ON tanaghom.content_items TO tanaghom_api;
GRANT UPDATE (status, response_status, response_body, completed_at)
ON tanaghom.api_idempotency_keys TO tanaghom_api;

GRANT SELECT ON
  tanaghom.campaigns,
  tanaghom.campaign_strategies,
  tanaghom.agents,
  tanaghom.agent_jobs,
  tanaghom.content_items,
  tanaghom.outbox_events
TO tanaghom_n8n_worker;

INSERT INTO public.schema_migrations(version)
VALUES ('0004_least_privilege_roles');

COMMIT;
