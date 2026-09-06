\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE secret text; BEGIN
 IF current_database()<>'tanaghom_test' OR (SELECT max(version) FROM public.schema_migrations)<>'0035_agency_workspace'
 THEN RAISE EXCEPTION 'exact workspace test baseline required'; END IF;
 secret:=rtrim(pg_read_file('/run/secrets/workspace_worker_password'),chr(13)||chr(10));
 IF secret !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid generated worker password'; END IF;
 EXECUTE format('ALTER ROLE tanaghom_agency_pilot_worker LOGIN PASSWORD %L',secret);
END $$;
REVOKE ALL ON DATABASE tanaghom_test FROM tanaghom_agency_pilot_worker;
GRANT CONNECT ON DATABASE tanaghom_test TO tanaghom_agency_pilot_worker;
ALTER ROLE tanaghom_agency_pilot_worker SET statement_timeout='10s';
ALTER ROLE tanaghom_agency_pilot_worker SET idle_in_transaction_session_timeout='10s';
COMMIT;
