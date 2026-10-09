BEGIN;

DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0044_creative_video_lane'
 THEN RAISE EXCEPTION '0045 requires exact 0044 baseline'; END IF;
END $$;

-- Resequencing note: P0 reserved 0041/0042/0043 for voice consent,
-- web/growth, and credits respectively; none have started. The P2a
-- segmentation follow-up takes 0045. Function-heavy migration with two
-- additive vocabulary widenings (method lists gain 'segment'); no new
-- tables: segmentation jobs use capability 'product_shoot', lane
-- 'cpu', params.operation='segment'.

-- Additive method vocabulary widening (same signatures, existing
-- grants hold): segmentation outputs register with method 'segment'.
ALTER TABLE tanaghom.creative_asset_versions DROP CONSTRAINT creative_asset_versions_method_check;
ALTER TABLE tanaghom.creative_asset_versions ADD CONSTRAINT creative_asset_versions_method_check
 CHECK(method IN ('mock','upload','render','edit','composite','segment'));

CREATE OR REPLACE FUNCTION tanaghom.create_creative_asset_version(p_job uuid,p_worker text,p_asset_id uuid,p_title text,p_mime text,p_width integer,p_height integer,p_duration_ms integer,p_bytes bigint,p_sha256 text,p_object_key text,p_thumb_key text,p_provenance jsonb,p_prompt_ref text,p_template_ref text,p_method text)
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
  OR p_method NOT IN ('mock','upload','render','edit','composite','segment')
 THEN RAISE EXCEPTION 'invalid creative asset version'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF NOT tanaghom.creative_object_key_is_scoped(p_object_key,j.organization_id) THEN RAISE EXCEPTION 'object key missing tenant scope'; END IF;
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
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(j.correlation_id,j.requested_by,'creative.asset_version_created','creative_asset_version',made,
  jsonb_build_object('asset_id',a,'version',v,'mime',p_mime,'method',p_method),'success');
 RETURN made;
END $$;

-- Controlled segment-input read for the least-privilege worker: job
-- params (operation, source ref, engine, refinement, limits) plus org,
-- correlation, and attempt counters. No table reads on the worker role.
CREATE FUNCTION tanaghom.get_creative_segment_input(p_job uuid,p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION 'invalid segment input lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF j.capability IS DISTINCT FROM 'product_shoot' OR j.lane IS DISTINCT FROM 'cpu'
  OR (j.params->>'operation') IS DISTINCT FROM 'segment'
 THEN RAISE EXCEPTION 'not a segmentation job'; END IF;
 RETURN jsonb_build_object(
  'job_id',j.id,'organization_id',j.organization_id,'capability',j.capability,'lane',j.lane,
  'correlation_id',j.correlation_id,'attempt',j.attempt,'max_attempts',j.max_attempts,
  'params',j.params);
END $$;

-- Tenant-checked source resolution for segmentation: object key + MIME
-- for one source asset version of the worker's own active job.
CREATE FUNCTION tanaghom.get_creative_segment_source(p_job uuid,p_worker text,p_version uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; row record;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200 OR p_version IS NULL
 THEN RAISE EXCEPTION 'invalid segment source lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF j.capability IS DISTINCT FROM 'product_shoot' THEN RAISE EXCEPTION 'not a segmentation job'; END IF;
 SELECT version.id,version.object_key,version.mime INTO row
  FROM tanaghom.creative_asset_versions version
  JOIN tanaghom.creative_assets asset ON asset.id=version.asset_id
  WHERE version.id=p_version AND asset.organization_id=j.organization_id;
 IF row.id IS NULL THEN RAISE EXCEPTION 'segment source not found'; END IF;
 RETURN jsonb_build_object('version_id',row.id,'object_key',row.object_key,'mime',row.mime);
END $$;

-- Capability-filtered claim for the segmentation worker: capability
-- product_shoot on lane cpu with params.operation='segment' only, same
-- advisory serialization, SKIP LOCKED fairness, and audit trail.
-- Compose/scene jobs (same capability+lane, other operations) are never
-- touched.
CREATE FUNCTION tanaghom.claim_creative_segment_job(p_worker text,p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(job_id uuid,organization_id uuid,capability text,lane text,params jsonb,attempt integer,max_attempts integer,correlation_id uuid,idempotency_key uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE picked tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600
 THEN RAISE EXCEPTION 'invalid segment claim'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE enabled AND NOT emergency_stop)
 THEN RAISE EXCEPTION 'creative runtime stopped'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('creative-claim:cpu',0));
 SELECT * INTO picked FROM tanaghom.creative_jobs AS job
  WHERE job.status='queued' AND job.lane='cpu' AND job.capability='product_shoot'
   AND (job.params->>'operation')='segment'
   AND NOT job.cancel_requested AND job.available_at<=now()
  ORDER BY job.priority DESC, job.created_at LIMIT 1 FOR UPDATE OF job SKIP LOCKED;
 IF picked.id IS NULL THEN RETURN; END IF;
 UPDATE tanaghom.creative_jobs SET status='claimed',attempt=tanaghom.creative_jobs.attempt+1,claimed_by=p_worker,
  lease_expires_at=now()+make_interval(secs=>p_lease_seconds),heartbeat_at=now(),started_at=coalesce(tanaghom.creative_jobs.started_at,now()),updated_at=now()
  WHERE id=picked.id;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(picked.organization_id,picked.id,'queued','claimed','worker',p_worker,'claimed segment lane cpu');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(picked.organization_id,picked.id,'job_claimed',jsonb_build_object('lane','cpu','worker',p_worker,'attempt',picked.attempt+1),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(picked.correlation_id,picked.requested_by,'creative.job_claimed','creative_job',picked.id,jsonb_build_object('lane','cpu','worker',p_worker,'attempt',picked.attempt+1),'success');
 RETURN QUERY SELECT picked.id,picked.organization_id,picked.capability,picked.lane,picked.params,picked.attempt+1,picked.max_attempts,picked.correlation_id,picked.idempotency_key;
END $$;

-- Cooperative cancellation poll for segmentation renders.
CREATE FUNCTION tanaghom.get_creative_segment_state(p_job uuid,p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION 'invalid segment state lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 RETURN jsonb_build_object('status',j.status,'cancel_requested',coalesce(j.cancel_requested,false));
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_segment_input(uuid,text) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_segment_source(uuid,text,uuid) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.claim_creative_segment_job(text,int) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_segment_state(uuid,text) TO tanaghom_creative_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0045_creative_segmentation');
COMMIT;
