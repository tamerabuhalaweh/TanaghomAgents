\set ON_ERROR_STOP on
\getenv api_password API_PASSWORD
\getenv workspace_password WORKSPACE_PASSWORD

BEGIN;
SELECT set_config('tanaghom.demo_api_password', :'api_password', false) \gset
SELECT set_config('tanaghom.demo_workspace_password', :'workspace_password', false) \gset
DO $$
DECLARE demo_password text := current_setting('tanaghom.demo_api_password');
        worker_password text := current_setting('tanaghom.demo_workspace_password');
BEGIN
  IF current_database() <> 'tanaghom_demo' THEN
    RAISE EXCEPTION 'demo database name required';
  END IF;
  IF (SELECT count(*) FROM public.schema_migrations) <> 45
     OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0048_gemini_workspace_model' THEN
    RAISE EXCEPTION 'demo database must be at exact migration 0048 ledger (45 migrations)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'tanaghom_api'
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'restricted tanaghom_api role required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'tanaghom_agency_pilot_worker'
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'restricted tanaghom_agency_pilot_worker role required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
     WHERE r.rolname IN ('tanaghom_api','tanaghom_agency_pilot_worker')
  ) THEN
    RAISE EXCEPTION 'demo database roles must not inherit another role';
  END IF;
  IF demo_password !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid generated demo API password';
  END IF;
  IF worker_password !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid generated workspace worker password';
  END IF;
  EXECUTE format('ALTER ROLE tanaghom_api LOGIN PASSWORD %L', demo_password);
  EXECUTE format('ALTER ROLE tanaghom_agency_pilot_worker LOGIN PASSWORD %L', worker_password);
  PERFORM set_config('tanaghom.demo_api_password', '', false);
  PERFORM set_config('tanaghom.demo_workspace_password', '', false);
END $$;
REVOKE ALL ON DATABASE tanaghom_demo FROM tanaghom_agency_pilot_worker;
GRANT CONNECT ON DATABASE tanaghom_demo TO tanaghom_agency_pilot_worker;
ALTER ROLE tanaghom_agency_pilot_worker SET statement_timeout = '10s';
ALTER ROLE tanaghom_agency_pilot_worker SET idle_in_transaction_session_timeout = '10s';
COMMIT;
