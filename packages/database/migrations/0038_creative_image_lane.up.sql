BEGIN;

DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0037_creative_studio_management'
 THEN RAISE EXCEPTION '0038 requires exact 0037 baseline'; END IF;
END $$;

-- Resequencing note: P0 proposed 0038 for credits, but no credit schema
-- exists on main and this slice needs image-lane provenance, not payment features.
-- 0038 carries provider-call metering + fidelity review. Credits move to
-- 0040, voice consent to 0041, web/growth to 0042. No credit ledger here.
-- See ADR 0025 and tasks/229.md.

-- One row per provider execution attempt. Retries are rows, never overwrites,
-- so indeterminate billed calls stay reconcilable.
CREATE TABLE tanaghom.creative_provider_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 job_id uuid NOT NULL REFERENCES tanaghom.creative_jobs(id),
 attempt_no integer NOT NULL CHECK(attempt_no BETWEEN 1 AND 100),
 provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 80),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 model_version text CHECK(model_version IS NULL OR length(model_version) BETWEEN 1 AND 200),
 operation text NOT NULL CHECK(operation IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head')),
 provider_request_id text CHECK(provider_request_id IS NULL OR length(provider_request_id) BETWEEN 1 AND 300),
 status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','succeeded','failed','cancelled','indeterminate')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 units jsonb NOT NULL DEFAULT '{}',
 estimated_cost_usd numeric(12,6) CHECK(estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
 actual_cost_usd numeric(12,6) CHECK(actual_cost_usd IS NULL OR actual_cost_usd >= 0),
 retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 100),
 error_class text CHECK(error_class IS NULL OR error_class IN ('transient','deterministic','capacity','cancelled','policy','indeterminate')),
 error_message text CHECK(error_message IS NULL OR length(error_message) BETWEEN 1 AND 2000),
 UNIQUE(job_id,attempt_no)
);
CREATE INDEX creative_provider_calls_job_idx ON tanaghom.creative_provider_calls(job_id,attempt_no);
CREATE INDEX creative_provider_calls_provider_idx ON tanaghom.creative_provider_calls(provider,model,status);

-- Fidelity reviews are append-only history; the version row carries the
-- derived current status for cheap reads. Reviews never mutate.
CREATE TABLE tanaghom.creative_fidelity_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 asset_version_id uuid NOT NULL REFERENCES tanaghom.creative_asset_versions(id),
 reviewer_id uuid NOT NULL REFERENCES tanaghom.app_users(id),
 checklist jsonb NOT NULL DEFAULT '{}',
 overall text NOT NULL CHECK(overall IN ('passed','failed','not_reviewed')),
 override_reason text CHECK(override_reason IS NULL OR length(override_reason) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creative_fidelity_reviews_version_idx ON tanaghom.creative_fidelity_reviews(asset_version_id,created_at);
CREATE TRIGGER creative_fidelity_reviews_immutable BEFORE UPDATE OR DELETE ON tanaghom.creative_fidelity_reviews
 FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();

ALTER TABLE tanaghom.creative_asset_versions
 ADD COLUMN fidelity_status text NOT NULL DEFAULT 'not_reviewed'
 CHECK(fidelity_status IN ('not_reviewed','passed','failed'));

-- The 0036 row guard allowlisted only review-state columns; fidelity status
-- is likewise append-driven (via record_creative_fidelity_review) and joins
-- the permitted set. Nothing else about the guard changes.
CREATE OR REPLACE FUNCTION tanaghom.guard_creative_asset_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF TG_OP='DELETE' OR
  (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at','fidelity_status']) IS DISTINCT FROM
  (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at','fidelity_status']) THEN RAISE EXCEPTION 'creative asset versions are immutable except review state'; END IF;
 RETURN NEW;
END $$;

-- Record a provider attempt. Callable by the executing worker identity and
-- the API service path; tenancy is resolved from the job row, never trusted
-- from the caller.
CREATE FUNCTION tanaghom.record_creative_provider_call(p_job uuid,p_worker text,p_provider text,p_model text,p_model_version text,p_operation text,p_request_id text,p_units jsonb,p_est numeric,p_actual numeric,p_retries integer,p_status text,p_error_class text,p_error_message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; n integer; made uuid;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_provider IS NULL OR length(p_provider) NOT BETWEEN 1 AND 80
  OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 200
  OR (p_model_version IS NOT NULL AND length(p_model_version) NOT BETWEEN 1 AND 200)
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head')
  OR (p_request_id IS NOT NULL AND length(p_request_id) NOT BETWEEN 1 AND 300)
  OR p_units IS NULL OR jsonb_typeof(p_units)<>'object'
  OR (p_est IS NOT NULL AND p_est < 0) OR (p_actual IS NOT NULL AND p_actual < 0)
  OR p_retries IS NULL OR p_retries NOT BETWEEN 0 AND 100
  OR p_status NOT IN ('started','succeeded','failed','cancelled','indeterminate')
  OR (p_error_class IS NOT NULL AND p_error_class NOT IN ('transient','deterministic','capacity','cancelled','policy','indeterminate'))
  OR (p_error_message IS NOT NULL AND length(p_error_message) NOT BETWEEN 1 AND 2000)
 THEN RAISE EXCEPTION 'invalid provider call record'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker
  AND NOT (p_worker ~ '^[0-9a-f-]{36}$' AND EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=p_worker::uuid AND organization_id=j.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL))
 THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 SELECT coalesce(max(attempt_no),0)+1 INTO n FROM tanaghom.creative_provider_calls WHERE job_id=p_job;
 INSERT INTO tanaghom.creative_provider_calls(organization_id,job_id,attempt_no,provider,model,model_version,operation,provider_request_id,status,units,estimated_cost_usd,actual_cost_usd,retry_count,error_class,error_message,finished_at)
 VALUES(j.organization_id,p_job,n,p_provider,p_model,p_model_version,p_operation,p_request_id,p_status,p_units,p_est,p_actual,p_retries,p_error_class,p_error_message,
  CASE WHEN p_status IN ('started') THEN NULL ELSE now() END)
 RETURNING id INTO made;
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(j.organization_id,p_job,'job_running',jsonb_build_object('provider',p_provider,'model',p_model,'operation',p_operation,'call_status',p_status),'success');
 RETURN made;
END $$;

-- Fidelity review append + derived status. Approval gating itself stays on
-- the API path (owner override + reason), which reads fidelity_status.
CREATE FUNCTION tanaghom.record_creative_fidelity_review(p_actor uuid,p_version uuid,p_checklist jsonb,p_overall text,p_override_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ver tanaghom.creative_asset_versions%ROWTYPE; w tanaghom.creative_assets%ROWTYPE; actor_role text; made uuid;
BEGIN
 IF p_actor IS NULL OR p_version IS NULL
  OR p_overall NOT IN ('passed','failed','not_reviewed')
  OR p_checklist IS NULL OR jsonb_typeof(p_checklist)<>'object'
  OR (p_override_reason IS NOT NULL AND length(p_override_reason) NOT BETWEEN 1 AND 2000)
 THEN RAISE EXCEPTION 'invalid fidelity review'; END IF;
 SELECT * INTO ver FROM tanaghom.creative_asset_versions WHERE id=p_version FOR UPDATE;
 IF ver.id IS NULL THEN RAISE EXCEPTION 'unknown creative asset version'; END IF;
 SELECT * INTO w FROM tanaghom.creative_assets WHERE id=ver.asset_id;
 SELECT app_users.role INTO actor_role FROM tanaghom.app_users WHERE id=p_actor AND organization_id=w.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF actor_role IS NULL OR actor_role NOT IN ('owner','reviewer') THEN RAISE EXCEPTION 'fidelity review requires owner or reviewer'; END IF;
 IF p_overall='passed' AND p_override_reason IS NOT NULL THEN RAISE EXCEPTION 'override reason only with failed fidelity'; END IF;
 INSERT INTO tanaghom.creative_fidelity_reviews(organization_id,asset_version_id,reviewer_id,checklist,overall,override_reason)
 VALUES(w.organization_id,p_version,p_actor,p_checklist,p_overall,p_override_reason) RETURNING id INTO made;
 UPDATE tanaghom.creative_asset_versions SET fidelity_status=p_overall WHERE id=p_version;
 INSERT INTO tanaghom.creative_events(organization_id,asset_version_id,actor_user_id,action,payload,result)
 VALUES(w.organization_id,p_version,p_actor,'asset_approved',jsonb_build_object('fidelity',p_overall,'review_id',made),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 SELECT j.correlation_id,p_actor,'creative.fidelity_reviewed','creative_asset_version',p_version,
  jsonb_build_object('fidelity',p_overall,'review_id',made),'success'
 FROM tanaghom.creative_jobs j WHERE j.id=ver.job_id;
 RETURN made;
END $$;

-- Latest provider-call status for one job+operation. Lets a worker refuse a
-- blind retry after a terminal record without any direct table reads.
CREATE FUNCTION tanaghom.latest_creative_provider_call(p_job uuid,p_worker text,p_operation text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head')
 THEN RAISE EXCEPTION 'invalid provider call lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker
  AND NOT (p_worker ~ '^[0-9a-f-]{36}$' AND EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=p_worker::uuid AND organization_id=j.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL))
 THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 RETURN (SELECT status FROM tanaghom.creative_provider_calls WHERE job_id=p_job AND operation=p_operation ORDER BY attempt_no DESC LIMIT 1);
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
GRANT SELECT ON tanaghom.creative_provider_calls, tanaghom.creative_fidelity_reviews TO tanaghom_api, tanaghom_readonly;
GRANT EXECUTE ON FUNCTION
 tanaghom.record_creative_provider_call(uuid,text,text,text,text,text,text,jsonb,numeric,numeric,integer,text,text,text),
 tanaghom.record_creative_fidelity_review(uuid,uuid,jsonb,text,text)
TO tanaghom_api;
GRANT EXECUTE ON FUNCTION
 tanaghom.record_creative_provider_call(uuid,text,text,text,text,text,text,jsonb,numeric,numeric,integer,text,text,text),
 tanaghom.latest_creative_provider_call(uuid,text,text)
TO tanaghom_creative_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0038_creative_image_lane');
COMMIT;
