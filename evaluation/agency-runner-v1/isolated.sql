-- Explicit disposable bootstrap, NOT a production schema migration.
BEGIN;
DO $$ BEGIN
 IF current_database() !~ '^tanaghom_quality_[a-f0-9]{12}$'
 OR (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0034_agency_pilot_integration'
 THEN RAISE EXCEPTION 'isolated quality database at exact 0034 required'; END IF;
END $$;
CREATE SCHEMA tanaghom_quality;
REVOKE ALL ON SCHEMA tanaghom_quality FROM PUBLIC;
CREATE TABLE tanaghom_quality.runs (
 id uuid PRIMARY KEY,
 manifest_hash text NOT NULL CHECK(manifest_hash ~ '^sha256:[a-f0-9]{64}$'),
 execution_kind text NOT NULL CHECK(execution_kind='simulated_model'),
 maximum_attempts integer NOT NULL CHECK(maximum_attempts BETWEEN 1 AND 400),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE tanaghom_quality.attempts (
 task_id uuid PRIMARY KEY REFERENCES tanaghom.agency_pilot_tasks(id),
 run_id uuid NOT NULL REFERENCES tanaghom_quality.runs(id),
 case_id text NOT NULL,
 profile_code text NOT NULL REFERENCES tanaghom.agency_pilot_profiles(code),
 language text NOT NULL CHECK(language IN ('en','ar')),
 arm text NOT NULL CHECK(arm IN ('baseline','adapted')),
 repetition integer NOT NULL CHECK(repetition BETWEEN 1 AND 3),
 case_hash text NOT NULL CHECK(case_hash ~ '^sha256:[a-f0-9]{64}$'),
 UNIQUE(run_id,case_id,arm,repetition),
 CHECK(arm='adapted' OR profile_code NOT IN ('brand_guardian','executive_summary'))
);
CREATE TABLE tanaghom_quality.stops (
 run_id uuid PRIMARY KEY REFERENCES tanaghom_quality.runs(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 100),
 stopped_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE FUNCTION tanaghom_quality.guard_registration() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('quality:'||NEW.run_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM tanaghom.agency_pilot_tasks t
  JOIN tanaghom.agency_pilot_bindings b ON b.id=t.binding_id
  JOIN tanaghom_quality.runs r ON r.id=NEW.run_id
  WHERE t.id=NEW.task_id AND t.status='queued' AND b.profile_code=NEW.profile_code AND t.language=NEW.language
    AND r.expires_at>statement_timestamp() AND NOT EXISTS(SELECT 1 FROM tanaghom_quality.stops s WHERE s.run_id=r.id)
    AND (SELECT count(*) FROM tanaghom_quality.attempts a WHERE a.run_id=r.id)<r.maximum_attempts)
 THEN RAISE EXCEPTION 'closed, exhausted or mismatched isolated run'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER registered BEFORE INSERT ON tanaghom_quality.attempts
FOR EACH ROW EXECUTE FUNCTION tanaghom_quality.guard_registration();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON tanaghom_quality.attempts
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON tanaghom_quality.runs
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON tanaghom_quality.stops
FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();
CREATE FUNCTION tanaghom_quality.read_attempt(p_task uuid,p_lease uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT to_jsonb(a)||jsonb_build_object('manifest_hash',r.manifest_hash,'execution_kind',r.execution_kind)
 FROM tanaghom_quality.attempts a JOIN tanaghom_quality.runs r ON r.id=a.run_id
 JOIN tanaghom.agency_pilot_tasks t ON t.id=a.task_id
 WHERE t.id=p_task AND t.lease_token=p_lease AND t.status='in_progress' AND t.lease_expires_at>statement_timestamp()
 AND r.expires_at>statement_timestamp() AND NOT EXISTS(SELECT 1 FROM tanaghom_quality.stops s WHERE s.run_id=r.id);
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA tanaghom_quality FROM PUBLIC,tanaghom_api,tanaghom_agency_pilot_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tanaghom_quality FROM PUBLIC,tanaghom_api,tanaghom_agency_pilot_worker;
GRANT USAGE ON SCHEMA tanaghom_quality TO tanaghom_agency_pilot_worker;
GRANT EXECUTE ON FUNCTION tanaghom_quality.read_attempt(uuid,uuid) TO tanaghom_agency_pilot_worker;
COMMIT;
