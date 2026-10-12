BEGIN;
DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0045_creative_segmentation' THEN RAISE EXCEPTION '0046 requires exact 0045 baseline'; END IF;
END $$;
-- 0041/42/43 remain reserved. Existing queue, storage and provider ledger reused.
CREATE TABLE IF NOT EXISTS tanaghom.creative_presenter_controls (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 talking_head_enabled boolean NOT NULL DEFAULT false,
 lip_sync_enabled boolean NOT NULL DEFAULT false,
 custom_avatar_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO tanaghom.creative_presenter_controls DEFAULT VALUES ON CONFLICT(singleton) DO UPDATE SET talking_head_enabled=false,lip_sync_enabled=false,custom_avatar_enabled=false;
CREATE TABLE IF NOT EXISTS tanaghom.creative_avatars (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 avatar_type text NOT NULL CHECK(avatar_type IN ('provider_stock','synthetic','custom_real_person')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('active','inactive','pending','blocked','revoked')),
 source_asset_version_id uuid REFERENCES tanaghom.creative_asset_versions(id),
 created_by uuid NOT NULL REFERENCES tanaghom.app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id)
);
CREATE TABLE IF NOT EXISTS tanaghom.creative_avatar_provider_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 avatar_id uuid NOT NULL, organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 provider text NOT NULL CHECK(provider IN ('heygen','sync','tavus')),
 provider_avatar_id text NOT NULL CHECK(length(provider_avatar_id) BETWEEN 1 AND 200),
 model text, model_version text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('active','inactive','pending','blocked','revoked')),
 metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(avatar_id,organization_id) REFERENCES tanaghom.creative_avatars(id,organization_id),
 UNIQUE(id,avatar_id,organization_id)
);
CREATE TABLE IF NOT EXISTS tanaghom.creative_avatar_consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 avatar_id uuid NOT NULL, organization_id uuid NOT NULL REFERENCES tanaghom.organizations(id),
 subject_reference text NOT NULL CHECK(length(subject_reference) BETWEEN 1 AND 200),
 subject_name text NOT NULL CHECK(length(subject_name) BETWEEN 1 AND 200),
 consent_status text NOT NULL DEFAULT 'pending' CHECK(consent_status IN ('pending','verified','rejected','revoked','expired')),
 consent_type text NOT NULL CHECK(length(consent_type) BETWEEN 1 AND 100),
 usage_scope jsonb NOT NULL CHECK(jsonb_typeof(usage_scope)='array'),
 obtained_at timestamptz NOT NULL, expires_at timestamptz, revoked_at timestamptz,
 evidence_asset_version_id uuid REFERENCES tanaghom.creative_asset_versions(id),
 approved_by uuid REFERENCES tanaghom.app_users(id), notes text CHECK(length(notes)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at IS NULL OR expires_at>obtained_at),
 CHECK(consent_status<>'verified' OR (approved_by IS NOT NULL AND evidence_asset_version_id IS NOT NULL AND revoked_at IS NULL)),
 FOREIGN KEY(avatar_id,organization_id) REFERENCES tanaghom.creative_avatars(id,organization_id)
);
-- No history deletion, no remote identity edits. Revocation is retained independently.
CREATE OR REPLACE FUNCTION tanaghom.guard_creative_avatar_governance() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE v uuid; org uuid; actor uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'avatar history retained'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)-ARRAY['status','consent_status','revoked_at','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','consent_status','revoked_at','updated_at']) THEN RAISE EXCEPTION 'avatar identity and evidence immutable'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(OLD)->>'status')='revoked' OR (to_jsonb(OLD)->>'consent_status')='revoked') THEN RAISE EXCEPTION 'revocation is final'; END IF;
 org:=NEW.organization_id;
 v:=coalesce((to_jsonb(NEW)->>'source_asset_version_id')::uuid,(to_jsonb(NEW)->>'evidence_asset_version_id')::uuid);
 IF v IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tanaghom.creative_asset_versions av JOIN tanaghom.creative_assets a ON a.id=av.asset_id WHERE av.id=v AND a.organization_id=org AND av.status='approved') THEN RAISE EXCEPTION 'tenant approved evidence required'; END IF;
 actor:=coalesce((to_jsonb(NEW)->>'created_by')::uuid,(to_jsonb(NEW)->>'approved_by')::uuid);
 -- Immutable authorship is historical, not the actor performing a status
 -- change. API RBAC authenticates the current owner; worker has no DML grants.
 IF TG_OP='INSERT' AND actor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tanaghom.app_users u WHERE u.id=actor AND u.organization_id=org AND u.kind='human' AND u.is_active AND u.accepted_at IS NOT NULL AND u.role='owner') THEN RAISE EXCEPTION 'tenant owner required'; END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='creative_avatars' THEN
  IF NEW.avatar_type='custom_real_person' AND NOT (SELECT custom_avatar_enabled FROM tanaghom.creative_presenter_controls) THEN RAISE EXCEPTION 'custom avatar disabled'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS creative_avatar_governance ON tanaghom.creative_avatars;
DROP TRIGGER IF EXISTS creative_binding_governance ON tanaghom.creative_avatar_provider_bindings;
DROP TRIGGER IF EXISTS creative_consent_governance ON tanaghom.creative_avatar_consents;
CREATE TRIGGER creative_avatar_governance BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.creative_avatars FOR EACH ROW EXECUTE FUNCTION tanaghom.guard_creative_avatar_governance();
CREATE TRIGGER creative_binding_governance BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.creative_avatar_provider_bindings FOR EACH ROW EXECUTE FUNCTION tanaghom.guard_creative_avatar_governance();
CREATE TRIGGER creative_consent_governance BEFORE INSERT OR UPDATE OR DELETE ON tanaghom.creative_avatar_consents FOR EACH ROW EXECUTE FUNCTION tanaghom.guard_creative_avatar_governance();
-- API accesses canonical P5 state only through actor-scoped functions.
CREATE FUNCTION tanaghom.read_creative_presenter_catalog(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid; result jsonb;
BEGIN
 SELECT u.organization_id INTO org FROM tanaghom.app_users u JOIN tanaghom.organizations o ON o.id=u.organization_id
 WHERE u.id=p_actor AND u.kind='human' AND u.is_active AND u.accepted_at IS NOT NULL AND u.role IN ('owner','operator','reviewer','viewer') AND o.is_active;
 IF org IS NULL THEN RAISE EXCEPTION 'active tenant actor required'; END IF;
 SELECT jsonb_build_object(
 'avatars',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
  SELECT a.id,a.name,a.avatar_type,a.status,b.id AS binding_id,b.provider,b.provider_avatar_id,b.model,b.status AS binding_status,
  coalesce(b.metadata->>'policy_approved','false')='true' AS policy_approved,
  (SELECT c.consent_status FROM tanaghom.creative_avatar_consents c WHERE c.avatar_id=a.id AND c.organization_id=a.organization_id ORDER BY c.created_at DESC,c.id DESC LIMIT 1) AS consent_status
  FROM tanaghom.creative_avatars a LEFT JOIN tanaghom.creative_avatar_provider_bindings b ON b.avatar_id=a.id AND b.organization_id=a.organization_id
  WHERE a.organization_id=org ORDER BY a.created_at DESC LIMIT 100) t),'[]'::jsonb),
 'inputs',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
  SELECT v.id,v.mime,v.title,v.duration_ms FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id=v.asset_id
  WHERE a.organization_id=org AND v.status='approved' AND v.mime IN ('video/mp4','audio/wav','audio/mpeg') ORDER BY v.created_at DESC LIMIT 100) t),'[]'::jsonb),
 'jobs',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
  SELECT id AS job_id,capability,status,created_at FROM tanaghom.creative_jobs WHERE organization_id=org AND capability IN ('talking_head','lip_sync') ORDER BY created_at DESC LIMIT 50) t),'[]'::jsonb),
 'flags',(SELECT jsonb_build_object('talking_head_enabled',talking_head_enabled,'lip_sync_enabled',lip_sync_enabled,'custom_avatar_enabled',custom_avatar_enabled) FROM tanaghom.creative_presenter_controls)) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION tanaghom.manage_creative_presenter(p_actor uuid,p_action text,p_body jsonb,p_custom_enabled boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid; made uuid; avatar uuid; kind text; allowed text[];
BEGIN
 SELECT u.organization_id INTO org FROM tanaghom.app_users u JOIN tanaghom.organizations o ON o.id=u.organization_id
 WHERE u.id=p_actor AND u.kind='human' AND u.is_active AND u.accepted_at IS NOT NULL AND u.role='owner' AND o.is_active;
 IF org IS NULL THEN RAISE EXCEPTION 'active tenant owner required'; END IF;
 allowed:=CASE p_action
 WHEN 'create_avatar' THEN ARRAY['name','avatar_type']
 WHEN 'add_binding' THEN ARRAY['avatar_id','provider','provider_avatar_id','voice_id','policy_approved']
 WHEN 'add_consent' THEN ARRAY['avatar_id','subject_reference','subject_name','consent_type','usage_scope','obtained_at','expires_at','evidence_asset_version_id','notes']
 WHEN 'set_avatar_status' THEN ARRAY['id','status'] WHEN 'set_binding_status' THEN ARRAY['id','status'] WHEN 'revoke_consent' THEN ARRAY['id'] END;
 IF allowed IS NULL OR p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) k WHERE k<>ALL(allowed||ARRAY['action','correlation_id'])) THEN RAISE EXCEPTION 'invalid governance action'; END IF;
 IF p_action='create_avatar' THEN
  kind:=p_body->>'avatar_type';
  IF kind='custom_real_person' AND (p_custom_enabled IS DISTINCT FROM true OR NOT (SELECT custom_avatar_enabled FROM tanaghom.creative_presenter_controls)) THEN RAISE EXCEPTION 'custom avatar disabled'; END IF;
  INSERT INTO tanaghom.creative_avatars(organization_id,name,avatar_type,status,created_by) VALUES(org,p_body->>'name',kind,'pending',p_actor) RETURNING id INTO made;
 ELSIF p_action IN ('add_binding','add_consent') THEN
  avatar:=(p_body->>'avatar_id')::uuid;
  SELECT a.avatar_type INTO kind FROM tanaghom.creative_avatars a WHERE a.id=avatar AND a.organization_id=org FOR UPDATE;
  IF kind IS NULL THEN RAISE EXCEPTION 'tenant avatar required' USING ERRCODE='P0002'; END IF;
  IF kind='custom_real_person' AND (p_custom_enabled IS DISTINCT FROM true OR NOT (SELECT custom_avatar_enabled FROM tanaghom.creative_presenter_controls)) THEN RAISE EXCEPTION 'custom avatar disabled'; END IF;
  IF p_action='add_binding' THEN
   IF p_body->>'provider' IS NULL OR p_body->>'provider' NOT IN ('heygen','sync') OR p_body->'policy_approved' IS DISTINCT FROM 'true'::jsonb OR coalesce(trim(p_body->>'provider_avatar_id'),'')='' OR (p_body->>'provider'='heygen' AND coalesce(trim(p_body->>'voice_id'),'')='') THEN RAISE EXCEPTION 'binding approval required'; END IF;
   INSERT INTO tanaghom.creative_avatar_provider_bindings(organization_id,avatar_id,provider,provider_avatar_id,model,model_version,status,metadata)
   VALUES(org,avatar,p_body->>'provider',p_body->>'provider_avatar_id',CASE WHEN p_body->>'provider'='heygen' THEN 'avatar_iv' ELSE 'lipsync-2' END,CASE WHEN p_body->>'provider'='heygen' THEN 'v3' ELSE 'v2' END,'active',jsonb_build_object('policy_approved',true,'policy_approved_by',p_actor,'voice_id',p_body->>'voice_id','supported_api_engines',CASE WHEN p_body->>'provider'='heygen' THEN '["avatar_iv"]'::jsonb ELSE '[]'::jsonb END)) RETURNING id INTO made;
  ELSE
   IF p_custom_enabled IS DISTINCT FROM true OR NOT (SELECT custom_avatar_enabled FROM tanaghom.creative_presenter_controls) OR jsonb_typeof(p_body->'usage_scope') IS DISTINCT FROM 'array' OR p_body->'usage_scope'='[]'::jsonb OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_body->'usage_scope') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' NOT IN ('talking_head','lip_sync')) OR (p_body->>'obtained_at')::timestamptz>now() THEN RAISE EXCEPTION 'invalid consent'; END IF;
   INSERT INTO tanaghom.creative_avatar_consents(organization_id,avatar_id,subject_reference,subject_name,consent_status,consent_type,usage_scope,obtained_at,expires_at,evidence_asset_version_id,approved_by,notes)
   VALUES(org,avatar,p_body->>'subject_reference',p_body->>'subject_name','verified',p_body->>'consent_type',p_body->'usage_scope',(p_body->>'obtained_at')::timestamptz,(p_body->>'expires_at')::timestamptz,(p_body->>'evidence_asset_version_id')::uuid,p_actor,p_body->>'notes') RETURNING id INTO made;
  END IF;
 ELSIF p_action='revoke_consent' THEN
  UPDATE tanaghom.creative_avatar_consents SET consent_status='revoked',revoked_at=now() WHERE id=(p_body->>'id')::uuid AND organization_id=org AND consent_status<>'revoked' RETURNING id INTO made;
 ELSE
  IF p_body->>'status' IS NULL OR p_body->>'status' NOT IN ('active','inactive','blocked','revoked') THEN RAISE EXCEPTION 'invalid status'; END IF;
  IF p_action='set_avatar_status' THEN UPDATE tanaghom.creative_avatars SET status=p_body->>'status' WHERE id=(p_body->>'id')::uuid AND organization_id=org RETURNING id INTO made;
  ELSE UPDATE tanaghom.creative_avatar_provider_bindings SET status=p_body->>'status' WHERE id=(p_body->>'id')::uuid AND organization_id=org RETURNING id INTO made; END IF;
 END IF;
 IF made IS NULL THEN RAISE EXCEPTION 'tenant governance record required' USING ERRCODE='P0002'; END IF;
 RETURN made;
END $$;
CREATE FUNCTION tanaghom.authorize_creative_presenter(p_org uuid,p_avatar uuid,p_binding uuid,p_operation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a tanaghom.creative_avatars%ROWTYPE; b tanaghom.creative_avatar_provider_bindings%ROWTYPE; c tanaghom.creative_avatar_consents%ROWTYPE;
BEGIN
 IF p_org IS NULL OR p_avatar IS NULL OR p_binding IS NULL OR p_operation IS NULL OR p_operation NOT IN ('talking_head','lip_sync') THEN RAISE EXCEPTION 'invalid presenter authorization'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE enabled AND NOT emergency_stop) OR NOT EXISTS(SELECT 1 FROM tanaghom.creative_presenter_controls WHERE CASE WHEN p_operation='talking_head' THEN talking_head_enabled ELSE lip_sync_enabled END) THEN RAISE EXCEPTION 'presenter execution disabled'; END IF;
 SELECT * INTO a FROM tanaghom.creative_avatars WHERE id=p_avatar AND organization_id=p_org;
 SELECT * INTO b FROM tanaghom.creative_avatar_provider_bindings WHERE id=p_binding AND avatar_id=p_avatar AND organization_id=p_org;
 IF a.id IS NULL OR b.id IS NULL OR a.status<>'active' OR b.status<>'active' OR b.metadata->>'policy_approved' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'presenter unavailable'; END IF;
 IF (p_operation='talking_head' AND (b.provider<>'heygen' OR b.model IS DISTINCT FROM 'avatar_iv' OR b.model_version IS DISTINCT FROM 'v3' OR coalesce(b.metadata->>'voice_id','')='' OR NOT coalesce(b.metadata->'supported_api_engines','[]'::jsonb) ? 'avatar_iv')) OR (p_operation='lip_sync' AND (b.provider<>'sync' OR b.model IS DISTINCT FROM 'lipsync-2' OR b.model_version IS DISTINCT FROM 'v2')) THEN RAISE EXCEPTION 'presenter provider model denied'; END IF;
 IF a.avatar_type='custom_real_person' THEN
  IF NOT (SELECT custom_avatar_enabled FROM tanaghom.creative_presenter_controls) THEN RAISE EXCEPTION 'custom avatar disabled'; END IF;
  SELECT * INTO c FROM tanaghom.creative_avatar_consents WHERE avatar_id=a.id AND organization_id=p_org AND usage_scope ? p_operation ORDER BY created_at DESC,id DESC LIMIT 1;
  IF c.id IS NULL OR c.consent_status<>'verified' OR c.revoked_at IS NOT NULL OR c.obtained_at>now() OR (c.expires_at IS NOT NULL AND c.expires_at<=now()) THEN RAISE EXCEPTION 'verified applicable consent required'; END IF;
 END IF;
 RETURN jsonb_build_object('avatar_id',a.id,'avatar_type',a.avatar_type,'binding_id',b.id,'provider_avatar_id',b.provider_avatar_id,'provider',b.provider,'model',b.model,'model_version',b.model_version,'voice_id',b.metadata->>'voice_id','consent_id',c.id);
END $$;
CREATE FUNCTION tanaghom.validate_creative_presenter_params(p_org uuid,p_params jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE auth jsonb; op text:=p_params->>'operation'; ref uuid; visual_duration integer; audio_duration integer;
BEGIN
 auth:=tanaghom.authorize_creative_presenter(p_org,(p_params->>'avatar_id')::uuid,(p_params->>'binding_id')::uuid,op);
 IF auth->>'avatar_type'='custom_real_person' AND (p_params->>'consent_id' IS NULL OR p_params->>'consent_id' IS DISTINCT FROM auth->>'consent_id') THEN RAISE EXCEPTION 'queued consent snapshot invalid'; END IF;
 IF p_params->>'duration' IS NULL OR (p_params->>'duration')::numeric NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'invalid presenter duration'; END IF;
 IF op='talking_head' THEN
  IF coalesce(length(trim(p_params->>'script')),0) NOT BETWEEN 1 AND 5000 OR p_params->>'locale' IS NULL OR p_params->>'locale' NOT IN ('ar','en','ar-EN') OR p_params->>'ratio' IS NULL OR p_params->>'ratio' NOT IN ('16:9','9:16','1:1') OR (p_params->>'duration')::numeric NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'invalid talking head params'; END IF;
  IF p_params->>'script_hash' IS DISTINCT FROM encode(public.digest(convert_to(p_params->>'script','UTF8'),'sha256'),'hex') OR p_params->>'script_length' IS DISTINCT FROM length(p_params->>'script')::text THEN RAISE EXCEPTION 'invalid script provenance'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_params) k WHERE k NOT IN ('operation','avatar_id','binding_id','consent_id','script','script_hash','script_length','locale','ratio','duration')) THEN RAISE EXCEPTION 'unknown presenter params'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_params) k WHERE k NOT IN ('operation','avatar_id','binding_id','consent_id','source_video_version_id','source_audio_version_id','duration')) THEN RAISE EXCEPTION 'no lip sync text or URLs'; END IF;
  ref:=(p_params->>'source_video_version_id')::uuid;
  SELECT v.duration_ms INTO visual_duration FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id=v.asset_id WHERE v.id=ref AND a.organization_id=p_org AND v.status='approved' AND v.mime='video/mp4' AND v.bytes<=104857600;
  ref:=(p_params->>'source_audio_version_id')::uuid;
  SELECT v.duration_ms INTO audio_duration FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id=v.asset_id WHERE v.id=ref AND a.organization_id=p_org AND v.status='approved' AND v.mime IN ('audio/wav','audio/mpeg') AND v.bytes<=52428800;
  IF visual_duration IS NULL OR audio_duration IS NULL OR visual_duration NOT BETWEEN 1 AND 60000 OR audio_duration NOT BETWEEN 1 AND 60000 OR abs(visual_duration-audio_duration)>250 THEN RAISE EXCEPTION 'approved tenant video and audio duration required'; END IF;
 END IF;
 RETURN auth;
END $$;
CREATE FUNCTION tanaghom.get_creative_presenter_input(p_job uuid,p_worker text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; auth jsonb;
BEGIN
 SELECT * INTO j FROM tanaghom.creative_jobs WHERE id=p_job;
 IF j.id IS NULL OR j.claimed_by IS DISTINCT FROM p_worker OR j.status NOT IN ('claimed','running') OR j.lane<>'gpu_video' OR j.capability NOT IN ('talking_head','lip_sync') OR j.params->>'operation' IS DISTINCT FROM j.capability THEN RAISE EXCEPTION 'presenter worker mismatch'; END IF;
 auth:=tanaghom.validate_creative_presenter_params(j.organization_id,j.params);
 RETURN jsonb_build_object('organization_id',j.organization_id,'correlation_id',j.correlation_id,'params',j.params,'authorization',auth);
END $$;
CREATE FUNCTION tanaghom.get_creative_presenter_source(p_job uuid,p_worker text,p_version uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE input jsonb; row record;
BEGIN
 input:=tanaghom.get_creative_presenter_input(p_job,p_worker);
 IF input->'params'->>'operation'<>'lip_sync' OR p_version::text NOT IN (input->'params'->>'source_video_version_id',input->'params'->>'source_audio_version_id') THEN RAISE EXCEPTION 'presenter source mismatch'; END IF;
 SELECT v.* INTO row FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id=v.asset_id WHERE v.id=p_version AND a.organization_id=(input->>'organization_id')::uuid AND v.status='approved';
 IF row.id IS NULL THEN RAISE EXCEPTION 'presenter source unavailable'; END IF;
 RETURN jsonb_build_object('version_id',row.id,'object_key',row.object_key,'mime',row.mime,'sha256',row.sha256,'bytes',row.bytes,'duration_ms',row.duration_ms,'width',row.width,'height',row.height);
END $$;

CREATE OR REPLACE FUNCTION tanaghom.create_creative_job(p_actor uuid,p_capability text,p_lane text,p_params jsonb,p_key uuid,p_correlation uuid,p_priority integer DEFAULT 0,p_max_attempts integer DEFAULT 3,p_template_ref text DEFAULT NULL,p_brand_kit_version_id uuid DEFAULT NULL,p_estimated_credits integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid; actor_role text; existing tanaghom.creative_jobs%ROWTYPE; made uuid; h text;
BEGIN
 SELECT app_users.organization_id, app_users.role INTO org, actor_role FROM tanaghom.app_users WHERE id=p_actor AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF org IS NULL THEN RAISE EXCEPTION 'unknown or inactive actor'; END IF;
 IF actor_role NOT IN ('owner','operator') THEN RAISE EXCEPTION 'creative enqueue requires owner or operator'; END IF;
 IF p_capability NOT IN ('image','edit','product_shoot','design','carousel','motion','video','talking_head','lip_sync','voice','music','landing_page')
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
 IF p_capability IN ('talking_head','lip_sync') THEN
  IF p_lane<>'gpu_video' OR p_params->>'operation' IS DISTINCT FROM p_capability THEN RAISE EXCEPTION 'presenter operation mismatch'; END IF;
  PERFORM tanaghom.validate_creative_presenter_params(org,p_params);
 END IF;
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
DECLARE j tanaghom.creative_jobs%ROWTYPE; n integer; made uuid; presenter jsonb;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_provider IS NULL OR length(p_provider) NOT BETWEEN 1 AND 80
  OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 200
  OR (p_model_version IS NOT NULL AND length(p_model_version) NOT BETWEEN 1 AND 200)
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head','lip_sync','text_to_video','image_to_video')
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
 IF j.capability IN ('talking_head','lip_sync') OR p_operation IN ('talking_head','lip_sync') THEN
  IF p_operation IS DISTINCT FROM j.capability THEN RAISE EXCEPTION 'invalid provider call begin: presenter operation mismatch'; END IF;
  presenter:=tanaghom.get_creative_presenter_input(p_job,p_worker)->'authorization';
  IF p_provider IS DISTINCT FROM presenter->>'provider' OR p_model IS DISTINCT FROM presenter->>'model' OR p_model_version IS DISTINCT FROM presenter->>'model_version' THEN RAISE EXCEPTION 'invalid provider call begin: presenter binding mismatch'; END IF;
  p_provider:=presenter->>'provider';p_model:=presenter->>'model';p_model_version:=presenter->>'model_version';
  p_units:=p_units||jsonb_build_object('avatar_id',presenter->>'avatar_id','binding_id',presenter->>'binding_id','provider_avatar_id',presenter->>'provider_avatar_id','consent_id',presenter->>'consent_id');
  IF EXISTS(SELECT 1 FROM tanaghom.creative_provider_calls WHERE job_id=p_job AND (provider_request_id IS NOT NULL OR status IN ('started','indeterminate'))) THEN RAISE EXCEPTION 'presenter attempt already exists'; END IF;
 END IF;
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
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head','lip_sync','text_to_video','image_to_video')
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
  OR p_operation NOT IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head','lip_sync','text_to_video','image_to_video')
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
CREATE OR REPLACE FUNCTION tanaghom.claim_creative_presenter_job(p_operation text,p_worker text,p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(job_id uuid,organization_id uuid,capability text,lane text,params jsonb,attempt integer,max_attempts integer,correlation_id uuid,idempotency_key uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE picked tanaghom.creative_jobs%ROWTYPE;
BEGIN
 IF p_operation IS NULL OR p_operation NOT IN ('talking_head','lip_sync') OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600
 THEN RAISE EXCEPTION 'invalid presenter claim'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE enabled AND NOT emergency_stop)
 THEN RAISE EXCEPTION 'creative runtime stopped'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('creative-claim:gpu_video',0));
 SELECT * INTO picked FROM tanaghom.creative_jobs AS job
  WHERE job.status='queued' AND job.lane='gpu_video' AND job.capability=p_operation AND job.params->>'operation'=p_operation
   AND NOT job.cancel_requested AND job.available_at<=now()
  ORDER BY job.priority DESC, job.created_at LIMIT 1 FOR UPDATE OF job SKIP LOCKED;
 IF picked.id IS NULL THEN RETURN; END IF;
 UPDATE tanaghom.creative_jobs SET status='claimed',attempt=tanaghom.creative_jobs.attempt+1,claimed_by=p_worker,
  lease_expires_at=now()+make_interval(secs=>p_lease_seconds),heartbeat_at=now(),started_at=coalesce(tanaghom.creative_jobs.started_at,now()),updated_at=now()
  WHERE id=picked.id;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(picked.organization_id,picked.id,'queued','claimed','worker',p_worker,'claimed presenter lane gpu_video');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(picked.organization_id,picked.id,'job_claimed',jsonb_build_object('lane','gpu_video','worker',p_worker,'attempt',picked.attempt+1),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(picked.correlation_id,picked.requested_by,'creative.job_claimed','creative_job',picked.id,jsonb_build_object('lane','gpu_video','worker',p_worker,'attempt',picked.attempt+1),'success');
 RETURN QUERY SELECT picked.id,picked.organization_id,picked.capability,picked.lane,picked.params,picked.attempt+1,picked.max_attempts,picked.correlation_id,picked.idempotency_key;
END $$;
ALTER TABLE tanaghom.creative_jobs DROP CONSTRAINT creative_jobs_capability_check;
ALTER TABLE tanaghom.creative_jobs ADD CONSTRAINT creative_jobs_capability_check CHECK(capability IN ('image','edit','product_shoot','design','carousel','motion','video','talking_head','lip_sync','voice','music','landing_page'));
ALTER TABLE tanaghom.creative_assets DROP CONSTRAINT creative_assets_capability_check;
ALTER TABLE tanaghom.creative_assets ADD CONSTRAINT creative_assets_capability_check CHECK(capability IN ('image','edit','product_shoot','design','carousel','motion','video','talking_head','lip_sync','voice','music','landing_page'));
ALTER TABLE tanaghom.creative_provider_calls DROP CONSTRAINT creative_provider_calls_operation_check;
ALTER TABLE tanaghom.creative_provider_calls ADD CONSTRAINT creative_provider_calls_operation_check CHECK(operation IN ('text_to_image','image_to_image','segment','relight','enhance','compose','tts','music','video','talking_head','lip_sync','text_to_video','image_to_video'));
REVOKE ALL ON tanaghom.creative_avatars,tanaghom.creative_avatar_provider_bindings,tanaghom.creative_avatar_consents,tanaghom.creative_presenter_controls FROM PUBLIC,tanaghom_creative_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
-- No direct P5 table rights, including status/revocation columns.
REVOKE ALL ON tanaghom.creative_avatars,tanaghom.creative_avatar_provider_bindings,tanaghom.creative_avatar_consents,tanaghom.creative_presenter_controls FROM tanaghom_api;
REVOKE UPDATE(status) ON tanaghom.creative_avatars,tanaghom.creative_avatar_provider_bindings FROM tanaghom_api;
REVOKE UPDATE(consent_status,revoked_at) ON tanaghom.creative_avatar_consents FROM tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.read_creative_presenter_catalog(uuid),tanaghom.manage_creative_presenter(uuid,text,jsonb,boolean) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.authorize_creative_presenter(uuid,uuid,uuid,text),tanaghom.validate_creative_presenter_params(uuid,jsonb) TO tanaghom_api;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_presenter_input(uuid,text) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_presenter_source(uuid,text,uuid) TO tanaghom_creative_worker;
GRANT EXECUTE ON FUNCTION tanaghom.claim_creative_presenter_job(text,text,int) TO tanaghom_creative_worker;
INSERT INTO public.schema_migrations(version) VALUES('0046_creative_talking_head');
COMMIT;
