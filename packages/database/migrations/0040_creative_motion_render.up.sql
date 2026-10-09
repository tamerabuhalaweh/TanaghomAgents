BEGIN;

DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0039_creative_design_render'
 THEN RAISE EXCEPTION '0040 requires exact 0039 baseline'; END IF;
END $$;

-- Resequencing note: P0 reserved 0040 for credits, but P3 motion needs its
-- worker-boundary functions now and credits have not started. Credits move
-- to 0043 (voice consent 0041, web/growth 0042 hold). No new tables: motion
-- configs live in creative_templates (kind 'motion' exists since 0036) and
-- render jobs use capability 'motion' (0036 CHECK). See ADR 0027.

-- Controlled motion-input read for the least-privilege worker: the motion
-- spec/version, the pinned design document (org or global), the brand
-- snapshot, and every source asset the design references resolved to
-- object_key/MIME with tenant checks. The worker never reads tables.
CREATE FUNCTION tanaghom.get_creative_motion_input(p_job uuid,p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; motion jsonb; design jsonb; brand jsonb; sources jsonb; resolved jsonb; ref text;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION 'invalid motion input lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF j.capability IS DISTINCT FROM 'motion' OR j.lane IS DISTINCT FROM 'cpu' THEN RAISE EXCEPTION 'not a motion render job'; END IF;
 SELECT jsonb_build_object('id',t.id,'kind',t.kind,'name',t.name,'version',t.version,'is_active',t.is_active,'spec',t.spec)
  INTO motion FROM tanaghom.creative_templates t
  WHERE t.id=(j.params->>'motion_template_id')::uuid AND t.kind='motion'
   AND (t.organization_id=j.organization_id OR t.organization_id IS NULL);
 IF motion IS NULL THEN RAISE EXCEPTION 'unknown motion template'; END IF;
 IF j.params ? 'motion_version' AND j.params->>'motion_version' IS NOT NULL
  AND (motion->>'version')::int IS DISTINCT FROM (j.params->>'motion_version')::int
 THEN RAISE EXCEPTION 'motion version mismatch'; END IF;
 SELECT jsonb_build_object('id',t.id,'kind',t.kind,'name',t.name,'version',t.version,'is_active',t.is_active,'spec',t.spec)
  INTO design FROM tanaghom.creative_templates t
  WHERE t.id=((motion->'spec'->>'design_template_id'))::uuid AND (t.kind='ad' OR t.kind='carousel')
   AND (t.organization_id=j.organization_id OR t.organization_id IS NULL);
 IF design IS NULL THEN RAISE EXCEPTION 'unknown motion design template'; END IF;
 IF (motion->'spec' ? 'design_version') AND (motion->'spec'->>'design_version') IS NOT NULL
  AND (design->>'version')::int IS DISTINCT FROM (motion->'spec'->>'design_version')::int
 THEN RAISE EXCEPTION 'motion design version mismatch'; END IF;
 IF j.params ? 'brand_kit_version_id' AND j.params->>'brand_kit_version_id' IS NOT NULL THEN
  SELECT jsonb_build_object('id',v.id,'kit_id',v.kit_id,'version',v.version,'colors',v.colors)
   INTO brand FROM tanaghom.brand_kit_versions v JOIN tanaghom.brand_kits k ON k.id=v.kit_id
   WHERE v.id=(j.params->>'brand_kit_version_id')::uuid AND k.organization_id=j.organization_id;
  IF brand IS NULL THEN RAISE EXCEPTION 'unknown brand kit version'; END IF;
 END IF;
 -- Every asset version the pinned design references, tenant-checked. Both
 -- ad node arrays and carousel page node arrays plus background images.
 -- Any invisible or malformed ref fails the input closed.
 sources := '[]'::jsonb;
 FOR ref IN
  SELECT DISTINCT node->>'asset_version_id' FROM (
   SELECT jsonb_array_elements(COALESCE((design->'spec'->'nodes'),'[]'::jsonb)) AS node
   UNION ALL
   SELECT jsonb_array_elements(COALESCE((page->'nodes'),'[]'::jsonb)) AS node
    FROM jsonb_array_elements(COALESCE((design->'spec'->'pages'),'[]'::jsonb)) AS page
  ) AS nodes WHERE node->>'asset_version_id' IS NOT NULL
 LOOP
  IF ref !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'motion source not found'; END IF;
  SELECT jsonb_build_object('version_id',version.id,'object_key',version.object_key,'mime',version.mime)
   INTO resolved FROM tanaghom.creative_asset_versions version
   JOIN tanaghom.creative_assets asset ON asset.id=version.asset_id
   WHERE version.id=ref::uuid AND asset.organization_id=j.organization_id
   LIMIT 1;
  IF resolved IS NULL THEN RAISE EXCEPTION 'motion source not found'; END IF;
  sources := sources || resolved;
 END LOOP;
 IF (design->'spec'->'background'->>'image_version_id') IS NOT NULL THEN
  ref := (design->'spec'->'background'->>'image_version_id');
  IF ref !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'motion source not found'; END IF;
  SELECT jsonb_build_object('version_id',version.id,'object_key',version.object_key,'mime',version.mime)
   INTO resolved FROM tanaghom.creative_asset_versions version
   JOIN tanaghom.creative_assets asset ON asset.id=version.asset_id
   WHERE version.id=ref::uuid AND asset.organization_id=j.organization_id
   LIMIT 1;
  IF resolved IS NULL THEN RAISE EXCEPTION 'motion source not found'; END IF;
  sources := sources || resolved;
 END IF;
 RETURN jsonb_build_object(
  'job_id',j.id,'organization_id',j.organization_id,'capability',j.capability,'lane',j.lane,
  'correlation_id',j.correlation_id,'attempt',j.attempt,'max_attempts',j.max_attempts,
  'params',j.params,'motion',motion,'design',design,'brand_kit_version',coalesce(brand,'null'::jsonb),
  'source_assets',sources);
END $$;

-- Capability-filtered claim for the motion worker: capability 'motion' on
-- lane cpu only, same advisory serialization, SKIP LOCKED fairness, and
-- audit trail. Foreign CPU jobs are never touched.
CREATE FUNCTION tanaghom.claim_creative_motion_job(p_worker text,p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(job_id uuid,organization_id uuid,capability text,lane text,params jsonb,attempt integer,max_attempts integer,correlation_id uuid,idempotency_key uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE picked tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600
 THEN RAISE EXCEPTION 'invalid motion claim'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE enabled AND NOT emergency_stop)
 THEN RAISE EXCEPTION 'creative runtime stopped'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('creative-claim:cpu',0));
 SELECT * INTO picked FROM tanaghom.creative_jobs AS job
  WHERE job.status='queued' AND job.lane='cpu' AND job.capability='motion'
   AND NOT job.cancel_requested AND job.available_at<=now()
  ORDER BY job.priority DESC, job.created_at LIMIT 1 FOR UPDATE OF job SKIP LOCKED;
 IF picked.id IS NULL THEN RETURN; END IF;
 UPDATE tanaghom.creative_jobs SET status='claimed',attempt=tanaghom.creative_jobs.attempt+1,claimed_by=p_worker,
  lease_expires_at=now()+make_interval(secs=>p_lease_seconds),heartbeat_at=now(),started_at=coalesce(tanaghom.creative_jobs.started_at,now()),updated_at=now()
  WHERE id=picked.id;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(picked.organization_id,picked.id,'queued','claimed','worker',p_worker,'claimed motion lane cpu');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(picked.organization_id,picked.id,'job_claimed',jsonb_build_object('lane','cpu','worker',p_worker,'attempt',picked.attempt+1),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(picked.correlation_id,picked.requested_by,'creative.job_claimed','creative_job',picked.id,jsonb_build_object('lane','cpu','worker',p_worker,'attempt',picked.attempt+1),'success');
 RETURN QUERY SELECT picked.id,picked.organization_id,picked.capability,picked.lane,picked.params,picked.attempt+1,picked.max_attempts,picked.correlation_id,picked.idempotency_key;
END $$;

-- Cooperative cancellation poll for long motion renders: status plus
-- cancel flag, worker-ownership checked, no table access needed.
CREATE FUNCTION tanaghom.get_creative_motion_state(p_job uuid,p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION 'invalid motion state lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 RETURN jsonb_build_object('status',j.status,'cancel_requested',coalesce(j.cancel_requested,false));
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_motion_input(uuid,text) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.claim_creative_motion_job(text,int) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_motion_state(uuid,text) TO tanaghom_creative_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0040_creative_motion_render');
COMMIT;
