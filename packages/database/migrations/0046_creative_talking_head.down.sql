BEGIN;
-- Rollback removes executable P5 paths. Never narrow append-only capability
-- or provider-operation vocabulary; used identity/consent history is retained.
UPDATE tanaghom.creative_presenter_controls SET talking_head_enabled=false,lip_sync_enabled=false,custom_avatar_enabled=false;
REVOKE ALL ON tanaghom.creative_avatars,tanaghom.creative_avatar_provider_bindings,tanaghom.creative_avatar_consents,tanaghom.creative_presenter_controls FROM tanaghom_api;
REVOKE UPDATE(status) ON tanaghom.creative_avatars,tanaghom.creative_avatar_provider_bindings FROM tanaghom_api;
REVOKE UPDATE(consent_status,revoked_at) ON tanaghom.creative_avatar_consents FROM tanaghom_api;
REVOKE EXECUTE ON FUNCTION tanaghom.authorize_creative_presenter(uuid,uuid,uuid,text),tanaghom.validate_creative_presenter_params(uuid,jsonb) FROM tanaghom_api;
DROP FUNCTION tanaghom.read_creative_presenter_catalog(uuid);
DROP FUNCTION tanaghom.manage_creative_presenter(uuid,text,jsonb,boolean);
DROP FUNCTION tanaghom.claim_creative_presenter_job(text,text,int);
DROP FUNCTION tanaghom.get_creative_presenter_source(uuid,text,uuid);
DROP FUNCTION tanaghom.get_creative_presenter_input(uuid,text);
DROP FUNCTION tanaghom.validate_creative_presenter_params(uuid,jsonb);
DROP FUNCTION tanaghom.authorize_creative_presenter(uuid,uuid,uuid,text);
CREATE OR REPLACE FUNCTION tanaghom.create_creative_job(p_actor uuid,p_capability text,p_lane text,p_params jsonb,p_key uuid,p_correlation uuid,p_priority integer DEFAULT 0,p_max_attempts integer DEFAULT 3,p_template_ref text DEFAULT NULL,p_brand_kit_version_id uuid DEFAULT NULL,p_estimated_credits integer DEFAULT NULL)
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
CREATE OR REPLACE FUNCTION tanaghom.get_creative_provider_call(p_job uuid,p_worker text,p_operation text)
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
-- Capability and operation CHECK vocabulary deliberately remains widened.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_avatars) AND NOT EXISTS(SELECT 1 FROM tanaghom.creative_jobs WHERE capability IN ('talking_head','lip_sync')) THEN
  DROP TABLE tanaghom.creative_avatar_consents,tanaghom.creative_avatar_provider_bindings,tanaghom.creative_avatars,tanaghom.creative_presenter_controls;
  DROP FUNCTION tanaghom.guard_creative_avatar_governance();
 END IF;
END $$;
DELETE FROM public.schema_migrations WHERE version='0046_creative_talking_head';
COMMIT;
