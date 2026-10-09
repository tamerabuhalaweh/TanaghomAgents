BEGIN;

DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0040_creative_motion_render'
 THEN RAISE EXCEPTION '0044 requires exact 0040 baseline'; END IF;
END $$;

-- Resequencing note: P0 reserved 0041/0042/0043 for voice consent,
-- web/growth, and credits respectively; none have started. The P4
-- generative-video lane takes 0044. Function-only migration: provider
-- metering (creative_provider_calls), fidelity lineage, and the
-- output-count/version-asset readers are reused unchanged.

-- Table-level widening to match: the provider-calls operation CHECK
-- predates video. Same additive set, same constraint name.
ALTER TABLE tanaghom.creative_provider_calls DROP CONSTRAINT creative_provider_calls_operation_check;
ALTER TABLE tanaghom.creative_provider_calls ADD CONSTRAINT creative_provider_calls_operation_check
 CHECK(operation IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head','text_to_video','image_to_video'));

-- Additive widening (same signatures, existing grants hold): the P2a
-- provider-call operations predate video. text_to_video/image_to_video
-- join the allowlists so video attempts meter with full granularity.
CREATE OR REPLACE FUNCTION tanaghom.begin_creative_provider_call(p_job uuid,p_worker text,p_provider text,p_model text,p_model_version text,p_operation text,p_units jsonb,p_est numeric,p_adapter_config text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; n integer; made uuid;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_provider IS NULL OR length(p_provider) NOT BETWEEN 1 AND 80
  OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 200
  OR (p_model_version IS NOT NULL AND length(p_model_version) NOT BETWEEN 1 AND 200)
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head','text_to_video','image_to_video')
  OR p_units IS NULL OR jsonb_typeof(p_units)<>'object'
  OR (p_est IS NOT NULL AND p_est < 0)
  OR (p_adapter_config IS NOT NULL AND length(p_adapter_config) NOT BETWEEN 1 AND 100)
 THEN RAISE EXCEPTION 'invalid provider call begin'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker
  AND NOT (p_worker ~ '^[0-9a-f-]{36}$' AND EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=p_worker::uuid AND organization_id=j.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL))
 THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 SELECT coalesce(max(attempt_no),0)+1 INTO n FROM tanaghom.creative_provider_calls WHERE job_id=p_job;
 INSERT INTO tanaghom.creative_provider_calls(organization_id,job_id,attempt_no,provider,model,model_version,operation,status,units,estimated_cost_usd,adapter_config_version)
 VALUES(j.organization_id,p_job,n,p_provider,p_model,p_model_version,p_operation,'started',p_units,p_est,p_adapter_config)
 RETURNING id INTO made;
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(j.organization_id,p_job,'job_running',jsonb_build_object('provider',p_provider,'model',p_model,'operation',p_operation,'attempt_no',n,'call_status','started'),'success');
 RETURN made;
END $$;

CREATE OR REPLACE FUNCTION tanaghom.latest_creative_provider_call(p_job uuid,p_worker text,p_operation text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head','text_to_video','image_to_video')
 THEN RAISE EXCEPTION 'invalid provider call lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker
  AND NOT (p_worker ~ '^[0-9a-f-]{36}$' AND EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=p_worker::uuid AND organization_id=j.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL))
 THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 RETURN (SELECT status FROM tanaghom.creative_provider_calls WHERE job_id=p_job AND operation=p_operation ORDER BY attempt_no DESC LIMIT 1);
END $$;

-- Controlled video-input read for the least-privilege worker: job params
-- (operation, prompt, duration, resolution, ratio, source refs), org,
-- correlation, and attempt counters. No table reads on the worker role.
CREATE FUNCTION tanaghom.get_creative_video_input(p_job uuid,p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION 'invalid video input lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF j.capability IS DISTINCT FROM 'video' OR j.lane IS DISTINCT FROM 'gpu_video' THEN RAISE EXCEPTION 'not a video generation job'; END IF;
 RETURN jsonb_build_object(
  'job_id',j.id,'organization_id',j.organization_id,'capability',j.capability,'lane',j.lane,
  'correlation_id',j.correlation_id,'attempt',j.attempt,'max_attempts',j.max_attempts,
  'params',j.params);
END $$;

-- Tenant-checked source resolution for image-to-video: object key + MIME
-- for one source asset version of the worker's own active job.
CREATE FUNCTION tanaghom.get_creative_video_source(p_job uuid,p_worker text,p_version uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; row record;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200 OR p_version IS NULL
 THEN RAISE EXCEPTION 'invalid video source lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF j.capability IS DISTINCT FROM 'video' THEN RAISE EXCEPTION 'not a video generation job'; END IF;
 SELECT version.id,version.object_key,version.mime INTO row
  FROM tanaghom.creative_asset_versions version
  JOIN tanaghom.creative_assets asset ON asset.id=version.asset_id
  WHERE version.id=p_version AND asset.organization_id=j.organization_id;
 IF row.id IS NULL THEN RAISE EXCEPTION 'video source not found'; END IF;
 RETURN jsonb_build_object('version_id',row.id,'object_key',row.object_key,'mime',row.mime);
END $$;

-- Capability-filtered claim for the video worker: capability 'video' on
-- lane gpu_video only, same advisory serialization, SKIP LOCKED
-- fairness (priority DESC, created_at), and audit trail. Foreign GPU
-- jobs are never touched.
CREATE FUNCTION tanaghom.claim_creative_video_job(p_worker text,p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(job_id uuid,organization_id uuid,capability text,lane text,params jsonb,attempt integer,max_attempts integer,correlation_id uuid,idempotency_key uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE picked tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600
 THEN RAISE EXCEPTION 'invalid video claim'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE enabled AND NOT emergency_stop)
 THEN RAISE EXCEPTION 'creative runtime stopped'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('creative-claim:gpu_video',0));
 SELECT * INTO picked FROM tanaghom.creative_jobs AS job
  WHERE job.status='queued' AND job.lane='gpu_video' AND job.capability='video'
   AND NOT job.cancel_requested AND job.available_at<=now()
  ORDER BY job.priority DESC, job.created_at LIMIT 1 FOR UPDATE OF job SKIP LOCKED;
 IF picked.id IS NULL THEN RETURN; END IF;
 UPDATE tanaghom.creative_jobs SET status='claimed',attempt=tanaghom.creative_jobs.attempt+1,claimed_by=p_worker,
  lease_expires_at=now()+make_interval(secs=>p_lease_seconds),heartbeat_at=now(),started_at=coalesce(tanaghom.creative_jobs.started_at,now()),updated_at=now()
  WHERE id=picked.id;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(picked.organization_id,picked.id,'queued','claimed','worker',p_worker,'claimed video lane gpu_video');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(picked.organization_id,picked.id,'job_claimed',jsonb_build_object('lane','gpu_video','worker',p_worker,'attempt',picked.attempt+1),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(picked.correlation_id,picked.requested_by,'creative.job_claimed','creative_job',picked.id,jsonb_build_object('lane','gpu_video','worker',p_worker,'attempt',picked.attempt+1),'success');
 RETURN QUERY SELECT picked.id,picked.organization_id,picked.capability,picked.lane,picked.params,picked.attempt+1,picked.max_attempts,picked.correlation_id,picked.idempotency_key;
END $$;

-- One-way provider request anchor. After createTask returns a task_id,
-- the worker attaches it to the STARTED attempt immediately, so a crash
-- between create and first poll still leaves a recoverable anchor.
-- Immutability: attaching is allowed only while the attempt is started;
-- re-attaching the SAME id is idempotent, replacing it is rejected.
CREATE FUNCTION tanaghom.attach_creative_provider_request(p_call uuid,p_worker text,p_request_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c tanaghom.creative_provider_calls%ROWTYPE; j tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_call IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 1 AND 300
 THEN RAISE EXCEPTION 'invalid provider request attach'; END IF;
 SELECT * INTO c FROM tanaghom.creative_provider_calls WHERE id=p_call FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'unknown provider call'; END IF;
 IF c.status<>'started' THEN RAISE EXCEPTION 'provider attempt already terminal'; END IF;
 IF c.provider_request_id IS NOT NULL AND c.provider_request_id IS DISTINCT FROM p_request_id
 THEN RAISE EXCEPTION 'provider request already attached'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=c.job_id;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 UPDATE tanaghom.creative_provider_calls SET provider_request_id=p_request_id WHERE id=p_call;
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(c.organization_id,c.job_id,'job_running',jsonb_build_object('provider',c.provider,'model',c.model,'operation',c.operation,'attempt_no',c.attempt_no,'call_status','task_attached'),'success');
 RETURN p_request_id;
END $$;

-- Full latest-attempt record for resume decisions: call id, status,
-- error class, attached provider request id, attempt number. Returns
-- NULL when no attempt exists for the operation.
CREATE FUNCTION tanaghom.get_creative_provider_call(p_job uuid,p_worker text,p_operation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; c tanaghom.creative_provider_calls%ROWTYPE;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head','text_to_video','image_to_video')
 THEN RAISE EXCEPTION 'invalid provider call lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker
  AND NOT (p_worker ~ '^[0-9a-f-]{36}$' AND EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=p_worker::uuid AND organization_id=j.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL))
 THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 SELECT * INTO c FROM tanaghom.creative_provider_calls WHERE job_id=p_job AND operation=p_operation ORDER BY attempt_no DESC LIMIT 1;
 IF c.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('call_id',c.id,'status',c.status,'error_class',c.error_class,
  'provider_request_id',c.provider_request_id,'attempt_no',c.attempt_no,
  'provider',c.provider,'model',c.model,'operation',c.operation);
END $$;

-- Reconciliation of an UNRESOLVED attempt. The generic
-- finish_creative_provider_call() intentionally freezes terminal rows,
-- which would strand an `indeterminate` attempt forever: a resumed pass
-- could never record the provider's eventual truth on the same row.
-- This video-scoped function allows ONLY:
--   indeterminate -> succeeded | failed | cancelled
-- plus same-state idempotent re-writes. It requires the EXACT anchored
-- request id, keeps the same row/attempt number, updates actual cost
-- when known, and writes audit/event evidence. Terminal truth
-- (succeeded/failed/cancelled) can never be rewritten to a conflicting
-- state. P2a lifecycle semantics are untouched.
CREATE FUNCTION tanaghom.reconcile_creative_provider_call(p_call uuid,p_worker text,p_request_id text,p_status text,p_error_class text,p_error_message text,p_actual numeric)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c tanaghom.creative_provider_calls%ROWTYPE; j tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_call IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 1 AND 300
  OR p_status NOT IN ('succeeded','failed','cancelled','indeterminate')
  OR (p_error_class IS NOT NULL AND p_error_class NOT IN ('transient','deterministic','capacity','cancelled','policy','indeterminate'))
  OR (p_error_message IS NOT NULL AND length(p_error_message) NOT BETWEEN 1 AND 2000)
  OR (p_actual IS NOT NULL AND p_actual < 0)
 THEN RAISE EXCEPTION 'invalid provider reconcile'; END IF;
 SELECT * INTO c FROM tanaghom.creative_provider_calls WHERE id=p_call FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'unknown provider call'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=c.job_id;
 IF j.claimed_by IS DISTINCT FROM p_worker
  AND NOT (p_worker ~ '^[0-9a-f-]{36}$' AND EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=p_worker::uuid AND organization_id=j.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL))
 THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF c.provider_request_id IS DISTINCT FROM p_request_id THEN RAISE EXCEPTION 'provider request mismatch'; END IF;
 IF c.status IN ('succeeded','failed','cancelled') AND c.status IS DISTINCT FROM p_status THEN
  RAISE EXCEPTION 'provider terminal truth is immutable';
 END IF;
 IF c.status NOT IN ('indeterminate','succeeded','failed','cancelled') THEN
  RAISE EXCEPTION 'provider attempt not reconcilable';
 END IF;
 UPDATE tanaghom.creative_provider_calls
  SET status=p_status,error_class=coalesce(p_error_class,error_class),
   error_message=coalesce(p_error_message,error_message),
   actual_cost_usd=coalesce(p_actual,actual_cost_usd),finished_at=now()
  WHERE id=p_call;
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(c.organization_id,c.job_id,'job_running',jsonb_build_object('provider',c.provider,'model',c.model,'operation',c.operation,'attempt_no',c.attempt_no,'call_status',p_status,'reconciled',true),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 SELECT j.correlation_id,j.requested_by,'creative.provider_call_reconciled','creative_job',c.job_id,
  jsonb_build_object('provider',c.provider,'model',c.model,'operation',c.operation,'attempt_no',c.attempt_no,'status',p_status),
  CASE WHEN p_status IN ('succeeded') THEN 'success' ELSE 'failed' END;
 RETURN p_status;
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_video_input(uuid,text) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_video_source(uuid,text,uuid) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.claim_creative_video_job(text,int) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.attach_creative_provider_request(uuid,text,text) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_provider_call(uuid,text,text) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.reconcile_creative_provider_call(uuid,text,text,text,text,text,numeric) TO tanaghom_creative_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0044_creative_video_lane');
COMMIT;
