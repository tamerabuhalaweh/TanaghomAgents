BEGIN;
DROP FUNCTION tanaghom.get_creative_provider_call(uuid,text,text);
DROP FUNCTION tanaghom.attach_creative_provider_request(uuid,text,text);
DROP FUNCTION tanaghom.claim_creative_video_job(text,int);
DROP FUNCTION tanaghom.get_creative_video_source(uuid,text,uuid);
DROP FUNCTION tanaghom.get_creative_video_input(uuid,text);
-- The provider-call operation vocabulary (table CHECK + function lists)
-- stays widened on rollback: narrowing would violate existing video-op
-- attempt rows, and vocabulary is append-only by design. Function bodies
-- below are restored to their 0038 operation lists regardless.
CREATE OR REPLACE FUNCTION tanaghom.begin_creative_provider_call(p_job uuid,p_worker text,p_provider text,p_model text,p_model_version text,p_operation text,p_units jsonb,p_est numeric,p_adapter_config text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; n integer; made uuid;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_provider IS NULL OR length(p_provider) NOT BETWEEN 1 AND 80
  OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 200
  OR (p_model_version IS NOT NULL AND length(p_model_version) NOT BETWEEN 1 AND 200)
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head')
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
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head')
 THEN RAISE EXCEPTION 'invalid provider call lookup'; END IF;
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL THEN RAISE EXCEPTION 'unknown creative job'; END IF;
 IF j.claimed_by IS DISTINCT FROM p_worker
  AND NOT (p_worker ~ '^[0-9a-f-]{36}$' AND EXISTS(SELECT 1 FROM tanaghom.app_users WHERE id=p_worker::uuid AND organization_id=j.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL))
 THEN RAISE EXCEPTION 'creative worker mismatch'; END IF;
 RETURN (SELECT status FROM tanaghom.creative_provider_calls WHERE job_id=p_job AND operation=p_operation ORDER BY attempt_no DESC LIMIT 1);
END $$;
DELETE FROM public.schema_migrations WHERE version='0044_creative_video_lane';
COMMIT;
