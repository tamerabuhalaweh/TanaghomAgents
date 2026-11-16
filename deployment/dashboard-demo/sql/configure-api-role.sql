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
  IF (SELECT count(*) FROM public.schema_migrations) <> 50
     OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0053_workspace_step_retry' THEN
    RAISE EXCEPTION 'demo database must be at exact migration 0053 ledger (50 migrations)';
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

-- Workspace completion, claiming and retry are owned by migration 0053.
-- Do not recreate them here: fresh installs must receive the immutable-task
-- step-retry contract rather than in-place task resets.

CREATE OR REPLACE FUNCTION tanaghom.set_agency_workspace_circuit_breaker(p_enabled boolean,p_emergency_stop boolean,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=tanaghom,pg_temp AS $$
DECLARE state tanaghom.agency_workspace_control%ROWTYPE;
BEGIN
 IF p_enabled IS NULL OR p_emergency_stop IS NULL THEN RAISE EXCEPTION 'circuit breaker state required'; END IF;
 IF length(coalesce(p_reason,''))>500 THEN RAISE EXCEPTION 'circuit breaker reason too long'; END IF;
 UPDATE tanaghom.agency_workspace_control
    SET enabled=p_enabled,
        emergency_stop=p_emergency_stop,
        reason=CASE
          WHEN coalesce(nullif(trim(p_reason),''),'') LIKE 'OPERATOR_STOP:%' THEN trim(p_reason)
          WHEN p_emergency_stop THEN 'OPERATOR_STOP:' || coalesce(nullif(trim(p_reason),''),'Manual operator stop')
          ELSE 'Operational'
        END,
        updated_at=now()
  RETURNING * INTO state;
 RETURN jsonb_build_object('enabled',state.enabled,'emergency_stop',state.emergency_stop,'reason',state.reason);
END $$;

ALTER TABLE tanaghom.agency_workspace_control ALTER COLUMN enabled SET DEFAULT true;
ALTER TABLE tanaghom.agency_workspace_control ALTER COLUMN emergency_stop SET DEFAULT false;
ALTER TABLE tanaghom.agency_workspace_control ALTER COLUMN reason SET DEFAULT 'Operational';
UPDATE tanaghom.agency_workspace_control
   SET enabled=true,emergency_stop=false,reason='Operational',updated_at=now()
 WHERE reason NOT LIKE 'OPERATOR_STOP:%';

REVOKE ALL ON FUNCTION tanaghom.set_agency_workspace_circuit_breaker(boolean,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.set_agency_workspace_circuit_breaker(boolean,boolean,text) TO tanaghom_api;
COMMIT;
