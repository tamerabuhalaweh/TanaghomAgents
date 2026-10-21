\set ON_ERROR_STOP on
\getenv api_password API_PASSWORD

BEGIN;
SELECT set_config('tanaghom.demo_api_password', :'api_password', false) \gset
DO $$
DECLARE demo_password text := current_setting('tanaghom.demo_api_password');
BEGIN
  IF current_database() <> 'tanaghom_demo' THEN
    RAISE EXCEPTION 'demo database name required';
  END IF;
  IF (SELECT count(*) FROM public.schema_migrations) <> 44 THEN
    RAISE EXCEPTION 'demo database must be at exact migration 0047 ledger (44 migrations)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'tanaghom_api'
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
       AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'restricted tanaghom_api role required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
     WHERE r.rolname = 'tanaghom_api'
  ) THEN
    RAISE EXCEPTION 'tanaghom_api must not inherit another role';
  END IF;
  IF demo_password !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid generated demo API password';
  END IF;
  EXECUTE format('ALTER ROLE tanaghom_api LOGIN PASSWORD %L', demo_password);
  PERFORM set_config('tanaghom.demo_api_password', '', false);
END $$;
COMMIT;
