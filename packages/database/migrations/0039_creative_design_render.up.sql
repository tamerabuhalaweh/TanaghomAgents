BEGIN;

DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0038_creative_image_lane'
 THEN RAISE EXCEPTION '0039 requires exact 0038 baseline'; END IF;
END $$;

-- Resequencing note: P0 proposed 0039 for voice consent, but no voice schema
-- exists on main and this slice needs a worker render-input reader, not
-- voice. Voice consent moves to 0041, web/growth to 0042, credits stay at
-- 0040. See ADR 0026 and tasks/232.md.

-- Controlled render-input read for the least-privilege worker: the full
-- validated design context (document spec/version, canvas, format, brand
-- snapshot, asset object keys) without any direct table reads.
CREATE FUNCTION tanaghom.get_creative_render_input(p_job uuid,p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; tpl jsonb; brand jsonb;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION 'invalid render input lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker
  AND NOT (p_worker ~ '^[0-9a-f-]{36}$' AND EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=p_worker::uuid AND organization_id=j.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL))
 THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.capability NOT IN ('design','carousel') THEN RAISE EXCEPTION 'not a design render job'; END IF;
 SELECT jsonb_build_object('id',t.id,'kind',t.kind,'name',t.name,'version',t.version,'is_active',t.is_active,'spec',t.spec)
   INTO tpl FROM tanaghom.creative_templates t WHERE t.id=(j.params->>'design_template_id')::uuid AND (t.organization_id=j.organization_id OR t.organization_id IS NULL);
 IF tpl IS NULL THEN RAISE EXCEPTION 'unknown design template'; END IF;
 IF j.params ? 'design_version' AND j.params->>'design_version' IS NOT NULL
  AND (tpl->>'version')::int IS DISTINCT FROM (j.params->>'design_version')::int
 THEN RAISE EXCEPTION 'design version mismatch'; END IF;
 IF j.params ? 'brand_kit_version_id' AND j.params->>'brand_kit_version_id' IS NOT NULL THEN
  SELECT jsonb_build_object('id',v.id,'kit_id',v.kit_id,'version',v.version,'colors',v.colors,'typography',v.typography,'arabic_font',v.arabic_font,'latin_font',v.latin_font,'logos',v.logos,'tone',v.tone,'rules',v.rules,'cta',v.cta,'channels',v.channels)
    INTO brand FROM tanaghom.brand_kit_versions v JOIN tanaghom.brand_kits k ON k.id=v.kit_id
   WHERE v.id=(j.params->>'brand_kit_version_id')::uuid AND k.organization_id=j.organization_id;
  IF brand IS NULL THEN RAISE EXCEPTION 'unknown brand kit version'; END IF;
 END IF;
 RETURN jsonb_build_object(
  'job_id',j.id,'organization_id',j.organization_id,'capability',j.capability,'lane',j.lane,
  'correlation_id',j.correlation_id,'attempt',j.attempt,'max_attempts',j.max_attempts,
  'params',j.params,'template',tpl,'brand_kit_version',coalesce(brand,'null'::jsonb));
END $$;

-- Tenant-checked source resolution for the least-privilege worker: object
-- key + MIME for one source asset version of the worker's own active job.
-- No table SELECT grant is needed on the worker role.
CREATE FUNCTION tanaghom.get_creative_render_source(p_job uuid,p_worker text,p_version uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; row record;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200 OR p_version IS NULL
 THEN RAISE EXCEPTION 'invalid render source lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 IF j.capability NOT IN ('design','carousel') THEN RAISE EXCEPTION 'not a design render job'; END IF;
 SELECT version.id,version.object_key,version.mime INTO row
  FROM tanaghom.creative_asset_versions version
  JOIN tanaghom.creative_assets asset ON asset.id=version.asset_id
  WHERE version.id=p_version AND asset.organization_id=j.organization_id;
 IF row.id IS NULL THEN RAISE EXCEPTION 'render source not found'; END IF;
 RETURN jsonb_build_object('version_id',row.id,'object_key',row.object_key,'mime',row.mime);
END $$;

-- Output guard for the least-privilege worker: how many asset versions
-- this render job already produced (duplicate-execution detection).
CREATE FUNCTION tanaghom.count_creative_render_outputs(p_job uuid,p_worker text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; n integer;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION 'invalid render output lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 SELECT count(*)::int INTO n FROM tanaghom.creative_asset_versions WHERE job_id=p_job;
 RETURN n;
END $$;

-- Controlled asset lookup for a just-registered version of the worker's own
-- job, so carousel slides can append versions to one asset lineage without
-- any table SELECT grant on the worker role.
CREATE FUNCTION tanaghom.get_creative_render_version_asset(p_job uuid,p_worker text,p_version uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; a uuid;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200 OR p_version IS NULL
 THEN RAISE EXCEPTION 'invalid render version lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 IF j.status NOT IN ('claimed','running') THEN RAISE EXCEPTION 'creative job not active'; END IF;
 SELECT asset_id INTO a FROM tanaghom.creative_asset_versions WHERE id=p_version AND job_id=p_job;
 IF a IS NULL THEN RAISE EXCEPTION 'render version not found'; END IF;
 RETURN a;
END $$;

-- Capability-filtered claim for the design worker: only capability IN
-- ('design','carousel') on lane cpu, same advisory serialization, SKIP
-- LOCKED fairness (priority DESC, created_at), and audit trail as the
-- generic claim. Foreign CPU jobs are never touched, so no lease is ever
-- stranded by a capability mismatch.
CREATE FUNCTION tanaghom.claim_creative_design_job(p_worker text,p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(job_id uuid,organization_id uuid,capability text,lane text,params jsonb,attempt integer,max_attempts integer,correlation_id uuid,idempotency_key uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE picked tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600
 THEN RAISE EXCEPTION 'invalid design claim'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE enabled AND NOT emergency_stop)
 THEN RAISE EXCEPTION 'creative runtime stopped'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('creative-claim:cpu',0));
 SELECT * INTO picked FROM tanaghom.creative_jobs AS job
  WHERE job.status='queued' AND job.lane='cpu' AND job.capability IN ('design','carousel')
   AND NOT job.cancel_requested AND job.available_at<=now()
  ORDER BY job.priority DESC, job.created_at LIMIT 1 FOR UPDATE OF job SKIP LOCKED;
 IF picked.id IS NULL THEN RETURN; END IF;
 UPDATE tanaghom.creative_jobs SET status='claimed',attempt=tanaghom.creative_jobs.attempt+1,claimed_by=p_worker,
  lease_expires_at=now()+make_interval(secs=>p_lease_seconds),heartbeat_at=now(),started_at=coalesce(tanaghom.creative_jobs.started_at,now()),updated_at=now()
  WHERE id=picked.id;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(picked.organization_id,picked.id,'queued','claimed','worker',p_worker,'claimed design lane cpu');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(picked.organization_id,picked.id,'job_claimed',jsonb_build_object('lane','cpu','worker',p_worker,'attempt',picked.attempt+1),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(picked.correlation_id,picked.requested_by,'creative.job_claimed','creative_job',picked.id,jsonb_build_object('lane','cpu','worker',p_worker,'attempt',picked.attempt+1),'success');
 RETURN QUERY SELECT picked.id,picked.organization_id,picked.capability,picked.lane,picked.params,picked.attempt+1,picked.max_attempts,picked.correlation_id,picked.idempotency_key;
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_render_input(uuid,text) TO tanaghom_api, tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_render_source(uuid,text,uuid) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.count_creative_render_outputs(uuid,text) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_render_version_asset(uuid,text,uuid) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.claim_creative_design_job(text,int) TO tanaghom_creative_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0039_creative_design_render');
COMMIT;
