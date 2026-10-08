BEGIN;

DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0035_agency_workspace'
 THEN RAISE EXCEPTION '0036 requires exact 0035 baseline'; END IF;
END $$;

-- Least-privilege worker role for Creative Runtime. Mirrors the 0004/0030/0034
-- role stanzas. Workers receive EXECUTE on controlled functions only, never
-- direct table privileges (see grants at the end of this migration).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tanaghom_creative_worker') THEN
  CREATE ROLE tanaghom_creative_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
 END IF;
END $$;

-- Feature/emergency control. Same singleton discipline as
-- agency_workspace_control (0035) and agent_runtime_controls (0030).
-- Default: disabled and stopped. P1a performs no provider execution.
CREATE TABLE tanaghom.creative_controls (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 emergency_stop boolean NOT NULL DEFAULT true,
 reason text NOT NULL DEFAULT 'Creative Runtime has not been enabled',
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tanaghom.creative_controls DEFAULT VALUES;

CREATE TABLE tanaghom.creative_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 requested_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
 idempotency_key uuid NOT NULL,
 input_hash text NOT NULL,
 correlation_id uuid NOT NULL,
 capability text NOT NULL CHECK(capability IN ('image','edit','product_shoot','design','carousel','motion','video','talking_head','voice','music','landing_page')),
 lane text NOT NULL CHECK(lane IN ('cpu','gpu_image','gpu_video','gpu_audio')),
 priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 100),
 params jsonb NOT NULL DEFAULT '{}',
 template_ref text,
 brand_kit_version_id uuid,
 provider text,
 model text,
 model_version text,
 job_version integer NOT NULL DEFAULT 1 CHECK(job_version BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','claimed','running','succeeded','failed','cancelled','expired')),
 attempt integer NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 100),
 max_attempts integer NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 10),
 claimed_by text,
 lease_expires_at timestamptz,
 heartbeat_at timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 finished_at timestamptz,
 cancel_requested boolean NOT NULL DEFAULT false,
 error_class text CHECK(error_class IS NULL OR error_class IN ('transient','deterministic','capacity','cancelled','policy','indeterminate')),
 error_message text CHECK(error_message IS NULL OR length(error_message) BETWEEN 1 AND 2000),
 estimated_credits integer CHECK(estimated_credits IS NULL OR estimated_credits >= 0),
 actual_credits integer CHECK(actual_credits IS NULL OR actual_credits >= 0),
 output_asset_ids uuid[] NOT NULL DEFAULT '{}',
 policy_result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX creative_jobs_claim_idx ON tanaghom.creative_jobs(lane,priority DESC,available_at,created_at)
 WHERE status = 'queued';
CREATE INDEX creative_jobs_correlation_idx ON tanaghom.creative_jobs(correlation_id);
CREATE INDEX creative_jobs_org_status_idx ON tanaghom.creative_jobs(organization_id,status,created_at);

CREATE TABLE tanaghom.creative_job_transitions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 job_id uuid NOT NULL REFERENCES tanaghom.creative_jobs(id),
 from_status text,
 to_status text NOT NULL CHECK(to_status IN ('queued','claimed','running','succeeded','failed','cancelled','expired')),
 actor_kind text NOT NULL CHECK(actor_kind IN ('human','worker','system')),
 actor_ref text NOT NULL CHECK(length(actor_ref) BETWEEN 1 AND 200),
 reason text CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creative_job_transitions_job_idx ON tanaghom.creative_job_transitions(job_id,created_at);
CREATE TRIGGER creative_job_transitions_immutable BEFORE UPDATE OR DELETE ON tanaghom.creative_job_transitions
 FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();

CREATE TABLE tanaghom.creative_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 capability text NOT NULL CHECK(capability IN ('image','edit','product_shoot','design','carousel','motion','video','talking_head','voice','music','landing_page')),
 title text CHECK(title IS NULL OR length(trim(title)) BETWEEN 1 AND 200),
 originating_job_id uuid REFERENCES tanaghom.creative_jobs(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tanaghom.creative_asset_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 asset_id uuid NOT NULL REFERENCES tanaghom.creative_assets(id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100000),
 parent_version_id uuid REFERENCES tanaghom.creative_asset_versions(id),
 job_id uuid NOT NULL REFERENCES tanaghom.creative_jobs(id),
 title text CHECK(title IS NULL OR length(trim(title)) BETWEEN 1 AND 200),
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp','video/mp4','audio/wav','audio/mpeg','text/html')),
 width integer CHECK(width IS NULL OR width BETWEEN 1 AND 16384),
 height integer CHECK(height IS NULL OR height BETWEEN 1 AND 16384),
 duration_ms integer CHECK(duration_ms IS NULL OR duration_ms BETWEEN 1 AND 3600000),
 bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 524288000),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 object_key text NOT NULL CHECK(length(object_key) BETWEEN 3 AND 512),
 thumb_key text CHECK(thumb_key IS NULL OR length(thumb_key) BETWEEN 3 AND 512),
 provenance jsonb NOT NULL DEFAULT '{}',
 prompt_ref text CHECK(prompt_ref IS NULL OR length(prompt_ref) BETWEEN 1 AND 300),
 template_ref text CHECK(template_ref IS NULL OR length(template_ref) BETWEEN 1 AND 300),
 method text NOT NULL CHECK(method IN ('mock','upload','render','edit','composite')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved','rejected','archived')),
 reviewed_by uuid REFERENCES tanaghom.app_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(asset_id,version)
);
CREATE INDEX creative_asset_versions_job_idx ON tanaghom.creative_asset_versions(job_id);
CREATE FUNCTION tanaghom.guard_creative_asset_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF TG_OP='DELETE' OR
  (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at']) IS DISTINCT FROM
  (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at']) THEN RAISE EXCEPTION 'creative asset versions are immutable except review state'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER creative_asset_versions_integrity BEFORE UPDATE OR DELETE ON tanaghom.creative_asset_versions
 FOR EACH ROW EXECUTE FUNCTION tanaghom.guard_creative_asset_version();

CREATE TABLE tanaghom.creative_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid REFERENCES tanaghom.organizations(id),
 kind text NOT NULL CHECK(kind IN ('ad','carousel','motion','landing','caption')),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 spec jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 1000),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,name,version)
);
CREATE UNIQUE INDEX creative_templates_org_kind_name_version_idx
 ON tanaghom.creative_templates(organization_id,kind,name,version) WHERE organization_id IS NOT NULL;

CREATE TABLE tanaghom.brand_kits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 current_version integer NOT NULL DEFAULT 1 CHECK(current_version BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,name)
);
CREATE TABLE tanaghom.brand_kit_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kit_id uuid NOT NULL REFERENCES tanaghom.brand_kits(id),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 colors jsonb NOT NULL DEFAULT '{}',
 typography jsonb NOT NULL DEFAULT '{}',
 arabic_font text CHECK(arabic_font IS NULL OR length(arabic_font) BETWEEN 1 AND 120),
 latin_font text CHECK(latin_font IS NULL OR length(latin_font) BETWEEN 1 AND 120),
 logos jsonb NOT NULL DEFAULT '{}',
 tone text CHECK(tone IS NULL OR length(tone) BETWEEN 1 AND 500),
 voice_ref text CHECK(voice_ref IS NULL OR length(voice_ref) BETWEEN 1 AND 300),
 rules jsonb NOT NULL DEFAULT '{}',
 cta jsonb NOT NULL DEFAULT '{}',
 channels jsonb NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kit_id,version)
);
CREATE TRIGGER brand_kit_versions_immutable BEFORE UPDATE OR DELETE ON tanaghom.brand_kit_versions
 FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();

CREATE TABLE tanaghom.creative_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 job_id uuid REFERENCES tanaghom.creative_jobs(id),
 asset_version_id uuid REFERENCES tanaghom.creative_asset_versions(id),
 actor_user_id uuid REFERENCES tanaghom.app_users(id),
 action text NOT NULL CHECK(action IN ('job_enqueued','job_claimed','job_running','job_heartbeat','job_failed','job_requeued','job_succeeded','job_cancel_requested','job_cancelled','job_expired','asset_created','asset_version_created','asset_approved','asset_rejected','control_changed')),
 payload jsonb NOT NULL DEFAULT '{}',
 result text CHECK(result IS NULL OR result IN ('success','failed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creative_events_job_idx ON tanaghom.creative_events(job_id,created_at);
CREATE INDEX creative_events_version_idx ON tanaghom.creative_events(asset_version_id,created_at);
CREATE TRIGGER creative_events_immutable BEFORE UPDATE OR DELETE ON tanaghom.creative_events
 FOR EACH ROW EXECUTE FUNCTION tanaghom.prevent_audit_mutation();

-- Enqueue. Owner/operator creation path; reviewers judge via decide path.
CREATE FUNCTION tanaghom.create_creative_job(p_actor uuid,p_capability text,p_lane text,p_params jsonb,p_key uuid,p_correlation uuid,p_priority integer DEFAULT 0,p_max_attempts integer DEFAULT 3,p_template_ref text DEFAULT NULL,p_brand_kit_version_id uuid DEFAULT NULL,p_estimated_credits integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid; actor_role text; existing tanaghom.creative_jobs%ROWTYPE; made uuid; h text;
BEGIN
 SELECT app_users.organization_id, app_users.role INTO org, actor_role FROM tanaghom.app_users WHERE id=p_actor AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF org IS NULL THEN RAISE EXCEPTION 'unknown or inactive actor'; END IF;
 IF actor_role NOT IN ('owner','operator') THEN RAISE EXCEPTION 'creative enqueue requires owner or operator'; END IF;
 IF p_capability NOT IN ('image','edit','product_shoot','design','carousel','motion','video','talking_head','voice','music','landing_page')
  OR p_lane NOT IN ('cpu','gpu_image','gpu_video','gpu_audio')
  OR p_key IS NULL OR p_correlation IS NULL OR p_params IS NULL OR jsonb_typeof(p_params)<>'object'
  OR p_priority IS NULL OR p_priority NOT BETWEEN 0 AND 100
  OR p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 10
  OR (p_template_ref IS NOT NULL AND length(p_template_ref) NOT BETWEEN 1 AND 300)
  OR (p_estimated_credits IS NOT NULL AND p_estimated_credits < 0)
 THEN RAISE EXCEPTION 'invalid creative job request'; END IF;
 IF NOT tanaghom.agent_runtime_json_is_safe(p_params,131072) THEN RAISE EXCEPTION 'unsafe or oversized job params'; END IF;
 IF p_brand_kit_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tanaghom.brand_kit_versions v JOIN tanaghom.brand_kits k ON k.id=v.kit_id WHERE v.id=p_brand_kit_version_id AND k.organization_id=org)
 THEN RAISE EXCEPTION 'unknown brand kit version'; END IF;
 h:=tanaghom.agent_runtime_sha256(jsonb_build_array(p_capability,p_lane,p_params,p_priority,p_max_attempts,p_template_ref,p_brand_kit_version_id));
 PERFORM pg_advisory_xact_lock(hashtextextended('creative:'||org::text||':'||p_key::text,0));
 SELECT * INTO existing FROM tanaghom.creative_jobs WHERE organization_id=org AND idempotency_key=p_key;
 IF FOUND THEN IF existing.input_hash<>h THEN RAISE EXCEPTION 'creative idempotency conflict'; END IF; RETURN existing.id; END IF;
 IF (SELECT count(*) FROM tanaghom.creative_jobs WHERE organization_id=org AND status IN ('queued','claimed','running'))>=100
 THEN RAISE EXCEPTION 'creative open job limit'; END IF;
 INSERT INTO tanaghom.creative_jobs(organization_id,requested_by,idempotency_key,input_hash,correlation_id,capability,lane,priority,params,template_ref,brand_kit_version_id,max_attempts,estimated_credits)
 VALUES(org,p_actor,p_key,h,p_correlation,p_capability,p_lane,p_priority,p_params,p_template_ref,p_brand_kit_version_id,p_max_attempts,p_estimated_credits) RETURNING id INTO made;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(org,made,NULL,'queued','human',p_actor::text,'enqueued');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,actor_user_id,action,payload,result)
 VALUES(org,made,p_actor,'job_enqueued',jsonb_build_object('capability',p_capability,'lane',p_lane,'correlation_id',p_correlation), 'success');
 RETURN made;
END $$;

-- Claim exactly one queued job per lane. Execution gate: enabled AND not stopped.
CREATE FUNCTION tanaghom.claim_creative_job(p_lane text,p_worker text,p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(job_id uuid,organization_id uuid,capability text,lane text,params jsonb,attempt integer,max_attempts integer,correlation_id uuid,idempotency_key uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE picked tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_lane NOT IN ('cpu','gpu_image','gpu_video','gpu_audio')
  OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600
 THEN RAISE EXCEPTION 'invalid creative claim'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE enabled AND NOT emergency_stop)
 THEN RAISE EXCEPTION 'creative runtime stopped'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('creative-claim:'||p_lane,0));
 SELECT * INTO picked FROM tanaghom.creative_jobs AS job
  WHERE job.status='queued' AND job.lane=p_lane AND NOT job.cancel_requested AND job.available_at<=now()
  ORDER BY job.priority DESC, job.created_at LIMIT 1 FOR UPDATE OF job SKIP LOCKED;
 IF picked.id IS NULL THEN RETURN; END IF;
 UPDATE tanaghom.creative_jobs SET status='claimed',attempt=tanaghom.creative_jobs.attempt+1,claimed_by=p_worker,
  lease_expires_at=now()+make_interval(secs=>p_lease_seconds),heartbeat_at=now(),started_at=coalesce(tanaghom.creative_jobs.started_at,now()),updated_at=now()
  WHERE id=picked.id;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(picked.organization_id,picked.id,'queued','claimed','worker',p_worker,'claimed lane '||p_lane);
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(picked.organization_id,picked.id,'job_claimed',jsonb_build_object('lane',p_lane,'worker',p_worker,'attempt',picked.attempt+1),'success');
 RETURN QUERY SELECT picked.id,picked.organization_id,picked.capability,picked.lane,picked.params,picked.attempt+1,picked.max_attempts,picked.correlation_id,picked.idempotency_key;
END $$;

-- Worker confirms execution start. Cooperative cancellation wins over running.
CREATE FUNCTION tanaghom.mark_creative_job_running(p_job uuid,p_worker text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid running marker'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status<>'claimed' THEN RAISE EXCEPTION 'creative job not claimed'; END IF;
 IF j.cancel_requested THEN
  UPDATE tanaghom.creative_jobs SET status='cancelled',finished_at=now(),updated_at=now() WHERE id=p_job;
  INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
  VALUES(j.organization_id,p_job,'claimed','cancelled','worker',p_worker,'cancel requested before run');
  INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
  VALUES(j.organization_id,p_job,'job_cancelled',jsonb_build_object('worker',p_worker),'success');
  RETURN 'cancelled';
 END IF;
 UPDATE tanaghom.creative_jobs SET status='running',updated_at=now() WHERE id=p_job;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(j.organization_id,p_job,'claimed','running','worker',p_worker,'execution started');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(j.organization_id,p_job,'job_running',jsonb_build_object('worker',p_worker),'success');
 RETURN 'running';
END $$;

CREATE FUNCTION tanaghom.heartbeat_creative_job(p_job uuid,p_worker text,p_lease_seconds integer DEFAULT 120)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; lease timestamptz;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600
 THEN RAISE EXCEPTION 'invalid creative heartbeat'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF j.lease_expires_at IS NULL OR j.lease_expires_at<now() THEN RAISE EXCEPTION 'creative lease expired'; END IF;
 lease:=now()+make_interval(secs=>p_lease_seconds);
 UPDATE tanaghom.creative_jobs SET lease_expires_at=lease,heartbeat_at=now(),updated_at=now() WHERE id=p_job;
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(j.organization_id,p_job,'job_heartbeat',jsonb_build_object('worker',p_worker),'success');
 RETURN lease;
END $$;

-- Success. Asset version must belong to this job and organization.
CREATE FUNCTION tanaghom.complete_creative_job(p_job uuid,p_worker text,p_asset_version_id uuid,p_actual_credits integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; v tanaghom.creative_asset_versions%ROWTYPE; asset_org uuid;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200 OR p_asset_version_id IS NULL
  OR (p_actual_credits IS NOT NULL AND p_actual_credits < 0)
 THEN RAISE EXCEPTION 'invalid creative completion'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 SELECT * INTO v FROM tanaghom.creative_asset_versions WHERE id=p_asset_version_id;
 IF v.id IS NULL OR v.job_id IS DISTINCT FROM p_job THEN RAISE EXCEPTION 'asset version does not belong to job'; END IF;
 SELECT organization_id INTO asset_org FROM tanaghom.creative_assets WHERE id=v.asset_id;
 IF asset_org IS NULL OR asset_org IS DISTINCT FROM j.organization_id THEN RAISE EXCEPTION 'cross-tenant asset completion forbidden'; END IF;
 UPDATE tanaghom.creative_jobs SET status='succeeded',actual_credits=p_actual_credits,
  output_asset_ids=array_append(output_asset_ids,(SELECT asset_id FROM tanaghom.creative_asset_versions WHERE id=p_asset_version_id)),
  finished_at=now(),updated_at=now() WHERE id=p_job;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(j.organization_id,p_job,j.status,'succeeded','worker',p_worker,'artifact persisted');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,asset_version_id,action,payload,result)
 VALUES(j.organization_id,p_job,p_asset_version_id,'job_succeeded',jsonb_build_object('worker',p_worker,'actual_credits',p_actual_credits),'success');
 RETURN 'succeeded';
END $$;

-- Failure with classified retry. Never blind-retries billed or policy work.
CREATE FUNCTION tanaghom.fail_creative_job(p_job uuid,p_worker text,p_error_class text,p_error_message text,p_retry_after_seconds integer DEFAULT 60)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; next_status text;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_error_class NOT IN ('transient','deterministic','capacity','cancelled','policy','indeterminate')
  OR p_error_message IS NULL OR length(p_error_message) NOT BETWEEN 1 AND 2000
  OR p_retry_after_seconds IS NULL OR p_retry_after_seconds NOT BETWEEN 0 AND 86400
 THEN RAISE EXCEPTION 'invalid creative failure'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF p_error_class='cancelled' THEN next_status:='cancelled';
 ELSIF p_error_class IN ('deterministic','policy') THEN next_status:='failed';
 ELSIF j.attempt>=j.max_attempts THEN next_status:='failed';
 ELSE next_status:='queued'; END IF;
 IF next_status='queued' THEN
  UPDATE tanaghom.creative_jobs SET status='queued',claimed_by=NULL,lease_expires_at=NULL,
   available_at=now()+make_interval(secs=>p_retry_after_seconds),error_class=p_error_class,error_message=p_error_message,updated_at=now() WHERE id=p_job;
  INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
  VALUES(j.organization_id,p_job,'job_requeued',jsonb_build_object('error_class',p_error_class,'attempt',j.attempt,'max_attempts',j.max_attempts),'success');
 ELSE
  UPDATE tanaghom.creative_jobs SET status=next_status,error_class=p_error_class,error_message=p_error_message,finished_at=now(),updated_at=now() WHERE id=p_job;
  INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
  VALUES(j.organization_id,p_job,'job_failed',jsonb_build_object('error_class',p_error_class,'terminal',next_status),'failed');
 END IF;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(j.organization_id,p_job,j.status,next_status,'worker',p_worker,left(p_error_class||': '||p_error_message,500));
 RETURN next_status;
END $$;

-- Human cancel request. Queued jobs cancel immediately; active jobs flag cooperatively.
CREATE FUNCTION tanaghom.request_creative_cancel(p_actor uuid,p_job uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; actor_role text;
BEGIN
 IF p_actor IS NULL OR p_job IS NULL THEN RAISE EXCEPTION 'invalid creative cancel'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 SELECT app_users.role INTO actor_role FROM tanaghom.app_users WHERE id=p_actor AND organization_id=j.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF actor_role IS NULL OR actor_role NOT IN ('owner','operator') THEN RAISE EXCEPTION 'creative cancel requires owner or operator'; END IF;
 IF j.status IN ('succeeded','failed','cancelled','expired') THEN RAISE EXCEPTION 'creative job already terminal'; END IF;
 IF j.status='queued' THEN
  UPDATE tanaghom.creative_jobs SET status='cancelled',cancel_requested=true,finished_at=now(),updated_at=now() WHERE id=p_job;
  INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
  VALUES(j.organization_id,p_job,'queued','cancelled','human',p_actor::text,'cancel requested before claim');
  INSERT INTO tanaghom.creative_events(organization_id,job_id,actor_user_id,action,payload,result)
  VALUES(j.organization_id,p_job,p_actor,'job_cancelled',jsonb_build_object('at_claim','immediate'),'success');
  RETURN 'cancelled';
 END IF;
 UPDATE tanaghom.creative_jobs SET cancel_requested=true,updated_at=now() WHERE id=p_job;
 INSERT INTO tanaghom.creative_events(organization_id,job_id,actor_user_id,action,payload,result)
 VALUES(j.organization_id,p_job,p_actor,'job_cancel_requested',jsonb_build_object('status',j.status),'success');
 RETURN 'cancel_requested';
END $$;

-- Reaper for lapsed leases. Callable by the worker loop; never revives terminal rows.
CREATE FUNCTION tanaghom.expire_creative_leases()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n integer := 0; r record;
BEGIN
 FOR r IN SELECT id,organization_id,status FROM tanaghom.creative_jobs
  WHERE status IN ('claimed','running') AND lease_expires_at IS NOT NULL AND lease_expires_at<now()
  ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LOOP
  UPDATE tanaghom.creative_jobs SET status='expired',finished_at=now(),updated_at=now() WHERE id=r.id;
  INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
  VALUES(r.organization_id,r.id,r.status,'expired','system','lease-reaper','lease lapsed without heartbeat');
  INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
  VALUES(r.organization_id,r.id,'job_expired',jsonb_build_object('prior_status',r.status),'failed');
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

-- Asset version registration by the executing worker. New asset when p_asset_id is null.
CREATE FUNCTION tanaghom.create_creative_asset_version(p_job uuid,p_worker text,p_asset_id uuid,p_title text,p_mime text,p_width integer,p_height integer,p_duration_ms integer,p_bytes bigint,p_sha256 text,p_object_key text,p_thumb_key text,p_provenance jsonb,p_prompt_ref text,p_template_ref text,p_method text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; a uuid; v integer; made uuid;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR (p_title IS NOT NULL AND length(trim(p_title)) NOT BETWEEN 1 AND 200)
  OR p_mime NOT IN ('image/png','image/jpeg','image/webp','video/mp4','audio/wav','audio/mpeg','text/html')
  OR (p_width IS NOT NULL AND (p_width NOT BETWEEN 1 AND 16384))
  OR (p_height IS NOT NULL AND (p_height NOT BETWEEN 1 AND 16384))
  OR (p_duration_ms IS NOT NULL AND (p_duration_ms NOT BETWEEN 1 AND 3600000))
  OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 524288000
  OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
  OR p_object_key IS NULL OR length(p_object_key) NOT BETWEEN 3 AND 512
  OR (p_thumb_key IS NOT NULL AND length(p_thumb_key) NOT BETWEEN 3 AND 512)
  OR p_provenance IS NULL OR jsonb_typeof(p_provenance)<>'object'
  OR (p_prompt_ref IS NOT NULL AND length(p_prompt_ref) NOT BETWEEN 1 AND 300)
  OR (p_template_ref IS NOT NULL AND length(p_template_ref) NOT BETWEEN 1 AND 300)
  OR p_method NOT IN ('mock','upload','render','edit','composite')
 THEN RAISE EXCEPTION 'invalid creative asset version'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF position(j.organization_id::text IN p_object_key)=0 THEN RAISE EXCEPTION 'object key missing tenant scope'; END IF;
 IF p_asset_id IS NULL THEN
  INSERT INTO tanaghom.creative_assets(organization_id,capability,title,originating_job_id)
  VALUES(j.organization_id,j.capability,coalesce(nullif(trim(p_title),''),'Untitled '||j.capability),p_job) RETURNING id INTO a;
  v:=1;
 ELSE
  SELECT id INTO a FROM tanaghom.creative_assets WHERE id=p_asset_id AND organization_id=j.organization_id;
  IF a IS NULL THEN RAISE EXCEPTION 'unknown creative asset'; END IF;
  IF EXISTS(SELECT 1 FROM tanaghom.creative_assets WHERE id=a AND originating_job_id IS DISTINCT FROM p_job
   AND EXISTS(SELECT 1 FROM tanaghom.creative_asset_versions WHERE asset_id=a AND job_id IS DISTINCT FROM p_job))
  THEN RAISE EXCEPTION 'asset owned by another job lineage'; END IF;
  SELECT coalesce(max(version),0)+1 INTO v FROM tanaghom.creative_asset_versions WHERE asset_id=a;
 END IF;
 INSERT INTO tanaghom.creative_asset_versions(asset_id,version,parent_version_id,job_id,title,mime,width,height,duration_ms,bytes,sha256,object_key,thumb_key,provenance,prompt_ref,template_ref,method)
 VALUES(a,v,(SELECT id FROM tanaghom.creative_asset_versions WHERE asset_id=a AND version=v-1),p_job,nullif(trim(p_title),''),p_mime,p_width,p_height,p_duration_ms,p_bytes,p_sha256,p_object_key,p_thumb_key,p_provenance,p_prompt_ref,p_template_ref,p_method)
 RETURNING id INTO made;
 INSERT INTO tanaghom.creative_events(organization_id,job_id,asset_version_id,action,payload,result)
 VALUES(j.organization_id,p_job,made,CASE WHEN v=1 THEN 'asset_created' ELSE 'asset_version_created' END,
  jsonb_build_object('asset_id',a,'version',v,'mime',p_mime,'bytes',p_bytes,'method',p_method),'success');
 RETURN made;
END $$;

-- Human review decision. Owner/reviewer path only; workers have no grant.
-- API layer writes the agent_actions_log row alongside this call.
CREATE FUNCTION tanaghom.decide_creative_asset_version(p_actor uuid,p_version uuid,p_decision text,p_feedback text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ver tanaghom.creative_asset_versions%ROWTYPE; w tanaghom.creative_assets%ROWTYPE; actor_role text; next_status text;
BEGIN
 IF p_actor IS NULL OR p_version IS NULL OR p_decision NOT IN ('approved','rejected')
  OR (p_feedback IS NOT NULL AND length(p_feedback) NOT BETWEEN 1 AND 2000)
 THEN RAISE EXCEPTION 'invalid creative asset decision'; END IF;
 IF p_decision='rejected' AND (p_feedback IS NULL OR length(trim(p_feedback))=0) THEN RAISE EXCEPTION 'asset rejection requires feedback'; END IF;
 SELECT * INTO ver FROM tanaghom.creative_asset_versions WHERE id=p_version FOR UPDATE;
 IF ver.id IS NULL THEN RAISE EXCEPTION 'unknown creative asset version'; END IF;
 SELECT * INTO w FROM tanaghom.creative_assets WHERE id=ver.asset_id;
 SELECT app_users.role INTO actor_role FROM tanaghom.app_users WHERE id=p_actor AND organization_id=w.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF actor_role IS NULL OR actor_role NOT IN ('owner','reviewer') THEN RAISE EXCEPTION 'creative decide requires owner or reviewer'; END IF;
 IF ver.status NOT IN ('draft','in_review') THEN RAISE EXCEPTION 'creative asset version not reviewable'; END IF;
 next_status:=CASE WHEN p_decision='approved' THEN 'approved' ELSE 'rejected' END;
 UPDATE tanaghom.creative_asset_versions SET status=next_status,reviewed_by=p_actor,reviewed_at=now() WHERE id=p_version;
 INSERT INTO tanaghom.creative_events(organization_id,asset_version_id,actor_user_id,action,payload,result)
 VALUES(w.organization_id,p_version,p_actor,CASE WHEN p_decision='approved' THEN 'asset_approved' ELSE 'asset_rejected' END,
  jsonb_build_object('asset_id',ver.asset_id,'version',ver.version,'feedback',p_feedback),'success');
 RETURN next_status;
END $$;

-- Global feature/emergency switch. Owner-only humans; workers have no grant.
CREATE FUNCTION tanaghom.set_creative_control(p_actor uuid,p_enabled boolean,p_emergency_stop boolean,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor_role text;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'invalid creative control change'; END IF;
 SELECT app_users.role INTO actor_role FROM tanaghom.app_users WHERE id=p_actor AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF actor_role IS NULL OR actor_role<>'owner' THEN RAISE EXCEPTION 'creative control requires owner'; END IF;
 UPDATE tanaghom.creative_controls SET enabled=coalesce(p_enabled,enabled),emergency_stop=coalesce(p_emergency_stop,emergency_stop),
  reason=coalesce(p_reason,reason),updated_at=now() WHERE singleton;
 INSERT INTO tanaghom.creative_events(organization_id,job_id,actor_user_id,action,payload,result)
 SELECT id,NULL,p_actor,'control_changed',jsonb_build_object('enabled',p_enabled,'emergency_stop',p_emergency_stop),'success'
 FROM tanaghom.organizations WHERE id=(SELECT organization_id FROM tanaghom.app_users WHERE id=p_actor) LIMIT 1;
END $$;

REVOKE ALL ON SCHEMA tanaghom FROM PUBLIC;
REVOKE ALL ON
 tanaghom.creative_controls,tanaghom.creative_jobs,tanaghom.creative_job_transitions,
 tanaghom.creative_assets,tanaghom.creative_asset_versions,tanaghom.creative_templates,
 tanaghom.brand_kits,tanaghom.brand_kit_versions,tanaghom.creative_events
FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tanaghom FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
GRANT USAGE ON SCHEMA tanaghom TO tanaghom_creative_worker;
GRANT SELECT ON
 tanaghom.creative_controls,tanaghom.creative_jobs,tanaghom.creative_job_transitions,
 tanaghom.creative_assets,tanaghom.creative_asset_versions,tanaghom.creative_templates,
 tanaghom.brand_kits,tanaghom.brand_kit_versions,tanaghom.creative_events
TO tanaghom_api, tanaghom_readonly;
GRANT EXECUTE ON FUNCTION
 tanaghom.create_creative_job(uuid,text,text,jsonb,uuid,uuid,int,int,text,uuid,int),
 tanaghom.request_creative_cancel(uuid,uuid),
 tanaghom.decide_creative_asset_version(uuid,uuid,text,text),
 tanaghom.set_creative_control(uuid,boolean,boolean,text)
TO tanaghom_api;
GRANT EXECUTE ON FUNCTION
 tanaghom.claim_creative_job(text,text,int),
 tanaghom.mark_creative_job_running(uuid,text),
 tanaghom.heartbeat_creative_job(uuid,text,int),
 tanaghom.complete_creative_job(uuid,text,uuid,int),
 tanaghom.fail_creative_job(uuid,text,text,text,int),
 tanaghom.expire_creative_leases(),
 tanaghom.create_creative_asset_version(uuid,text,uuid,text,text,int,int,int,bigint,text,text,text,jsonb,text,text,text)
TO tanaghom_creative_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0036_creative_foundation');
COMMIT;
