BEGIN;

DO $$ BEGIN
 IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0036_creative_foundation'
 THEN RAISE EXCEPTION '0037 requires exact 0036 baseline'; END IF;
END $$;

-- Resequencing note: P0 reconciliation reserved 0037 for credits, but that
-- was a proposal and no credit schema exists on main. This slice needs
-- studio-management functions and no credits, so 0037 carries brand,
-- template, and upload lifecycle functions instead. Credits move to 0038,
-- voice consent to 0039, web/growth to 0040. No credit ledger is created
-- here. See ADR 0024 and tasks/227.md.

-- Object keys are immutable identities: duplicates are rejected at the
-- database boundary in addition to storage-level exclusive writes.
ALTER TABLE tanaghom.creative_asset_versions
 ADD CONSTRAINT creative_asset_versions_object_key_unique UNIQUE(object_key);

-- Extend the creative_events action vocabulary (superset of the 0036 list;
-- all existing rows remain valid). Constraint name is resolved, not assumed.
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_constraint
  WHERE conrelid='tanaghom.creative_events'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%job_enqueued%';
 IF c IS NULL THEN RAISE EXCEPTION 'creative events action check not found'; END IF;
 EXECUTE format('ALTER TABLE tanaghom.creative_events DROP CONSTRAINT %I',c);
END $$;
ALTER TABLE tanaghom.creative_events ADD CONSTRAINT creative_events_action_check_v2 CHECK(action IN (
 'job_enqueued','job_claimed','job_running','job_heartbeat','job_failed','job_requeued',
 'job_succeeded','job_cancel_requested','job_cancelled','job_expired',
 'asset_created','asset_version_created','asset_approved','asset_rejected','control_changed',
 'brand_kit_created','brand_kit_version_created','brand_kit_current_set',
 'template_created','template_version_created','template_active_set','upload_registered'));

-- Brand Kit creation with first immutable version. Owner-only.
CREATE FUNCTION tanaghom.create_brand_kit(p_actor uuid,p_name text,p_colors jsonb DEFAULT '{}',p_typography jsonb DEFAULT '{}',p_arabic_font text DEFAULT NULL,p_latin_font text DEFAULT NULL,p_logos jsonb DEFAULT '{}',p_tone text DEFAULT NULL,p_rules jsonb DEFAULT '{}',p_cta jsonb DEFAULT '{}',p_channels jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid; actor_role text; kit uuid; col jsonb;
BEGIN
 SELECT app_users.organization_id, app_users.role INTO org, actor_role FROM tanaghom.app_users WHERE id=p_actor AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF org IS NULL THEN RAISE EXCEPTION 'unknown or inactive actor'; END IF;
 IF actor_role<>'owner' THEN RAISE EXCEPTION 'brand kit requires owner'; END IF;
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid brand kit name'; END IF;
 FOR col IN SELECT unnest(ARRAY[p_colors,p_typography,p_logos,p_rules,p_cta,p_channels]) LOOP
  IF col IS NULL OR jsonb_typeof(col)<>'object' THEN RAISE EXCEPTION 'brand kit fields must be objects'; END IF;
 END LOOP;
 IF (p_arabic_font IS NOT NULL AND length(p_arabic_font) NOT BETWEEN 1 AND 120)
  OR (p_latin_font IS NOT NULL AND length(p_latin_font) NOT BETWEEN 1 AND 120)
  OR (p_tone IS NOT NULL AND length(p_tone) NOT BETWEEN 1 AND 500)
 THEN RAISE EXCEPTION 'invalid brand kit text field'; END IF;
 INSERT INTO tanaghom.brand_kits(organization_id,name) VALUES(org,trim(p_name)) RETURNING id INTO kit;
 INSERT INTO tanaghom.brand_kit_versions(kit_id,version,colors,typography,arabic_font,latin_font,logos,tone,rules,cta,channels,created_by)
 VALUES(kit,1,coalesce(p_colors,'{}'),coalesce(p_typography,'{}'),p_arabic_font,p_latin_font,coalesce(p_logos,'{}'),p_tone,coalesce(p_rules,'{}'),coalesce(p_cta,'{}'),coalesce(p_channels,'{}'),p_actor);
 INSERT INTO tanaghom.creative_events(organization_id,actor_user_id,action,payload,result)
 VALUES(org,p_actor,'brand_kit_created',jsonb_build_object('kit_id',kit,'name',trim(p_name)),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(gen_random_uuid(),p_actor,'creative.brand_kit_created','brand_kit',kit,jsonb_build_object('name',trim(p_name)),'success');
 RETURN kit;
END $$;

-- New immutable brand-kit version. Never mutates prior versions; current
-- pointer moves only through set_brand_kit_current.
CREATE FUNCTION tanaghom.create_brand_kit_version(p_actor uuid,p_kit uuid,p_colors jsonb DEFAULT '{}',p_typography jsonb DEFAULT '{}',p_arabic_font text DEFAULT NULL,p_latin_font text DEFAULT NULL,p_logos jsonb DEFAULT '{}',p_tone text DEFAULT NULL,p_rules jsonb DEFAULT '{}',p_cta jsonb DEFAULT '{}',p_channels jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE k tanaghom.brand_kits%ROWTYPE; actor_role text; v integer; made uuid; col jsonb;
BEGIN
 IF p_kit IS NULL THEN RAISE EXCEPTION 'invalid brand kit version'; END IF;
 -- Serialize on the parent row so concurrent creates cannot pick the same next version.
 SELECT * INTO k FROM tanaghom.brand_kits WHERE id=p_kit FOR UPDATE;
 IF k.id IS NULL THEN RAISE EXCEPTION 'unknown brand kit'; END IF;
 SELECT app_users.role INTO actor_role FROM tanaghom.app_users WHERE id=p_actor AND organization_id=k.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF actor_role IS NULL OR actor_role<>'owner' THEN RAISE EXCEPTION 'brand kit requires owner'; END IF;
 FOR col IN SELECT unnest(ARRAY[p_colors,p_typography,p_logos,p_rules,p_cta,p_channels]) LOOP
  IF col IS NULL OR jsonb_typeof(col)<>'object' THEN RAISE EXCEPTION 'brand kit fields must be objects'; END IF;
 END LOOP;
 SELECT coalesce(max(version),0)+1 INTO v FROM tanaghom.brand_kit_versions WHERE kit_id=p_kit;
 INSERT INTO tanaghom.brand_kit_versions(kit_id,version,colors,typography,arabic_font,latin_font,logos,tone,rules,cta,channels,created_by)
 VALUES(p_kit,v,coalesce(p_colors,'{}'),coalesce(p_typography,'{}'),p_arabic_font,p_latin_font,coalesce(p_logos,'{}'),p_tone,coalesce(p_rules,'{}'),coalesce(p_cta,'{}'),coalesce(p_channels,'{}'),p_actor) RETURNING id INTO made;
 INSERT INTO tanaghom.creative_events(organization_id,actor_user_id,action,payload,result)
 VALUES(k.organization_id,p_actor,'brand_kit_version_created',jsonb_build_object('kit_id',p_kit,'version',v),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(gen_random_uuid(),p_actor,'creative.brand_kit_version_created','brand_kit',p_kit,jsonb_build_object('version',v),'success');
 RETURN made;
END $$;

CREATE FUNCTION tanaghom.set_brand_kit_current(p_actor uuid,p_kit uuid,p_version integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE k tanaghom.brand_kits%ROWTYPE; actor_role text;
BEGIN
 IF p_kit IS NULL OR p_version IS NULL OR p_version<1 THEN RAISE EXCEPTION 'invalid brand kit current'; END IF;
 SELECT * INTO k FROM tanaghom.brand_kits WHERE id=p_kit FOR UPDATE;
 IF k.id IS NULL THEN RAISE EXCEPTION 'unknown brand kit'; END IF;
 SELECT app_users.role INTO actor_role FROM tanaghom.app_users WHERE id=p_actor AND organization_id=k.organization_id AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF actor_role IS NULL OR actor_role<>'owner' THEN RAISE EXCEPTION 'brand kit requires owner'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.brand_kit_versions WHERE kit_id=p_kit AND version=p_version) THEN RAISE EXCEPTION 'unknown brand kit version'; END IF;
 UPDATE tanaghom.brand_kits SET current_version=p_version,updated_at=now() WHERE id=p_kit;
 INSERT INTO tanaghom.creative_events(organization_id,actor_user_id,action,payload,result)
 VALUES(k.organization_id,p_actor,'brand_kit_current_set',jsonb_build_object('kit_id',p_kit,'version',p_version),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(gen_random_uuid(),p_actor,'creative.brand_kit_current_set','brand_kit',p_kit,jsonb_build_object('version',p_version),'success');
 RETURN p_version;
END $$;

-- Template version creation, always organization-scoped to the actor's org.
-- There is deliberately no global path: platform-global rows are read-only
-- to organization users and are seeded only by a future explicit
-- platform-admin/system authority, never by tenant roles.
CREATE FUNCTION tanaghom.create_creative_template(p_actor uuid,p_kind text,p_name text,p_spec jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid; actor_role text; v integer; made uuid; tname text;
BEGIN
 SELECT app_users.organization_id, app_users.role INTO org, actor_role FROM tanaghom.app_users WHERE id=p_actor AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF org IS NULL THEN RAISE EXCEPTION 'unknown or inactive actor'; END IF;
 IF actor_role<>'owner' THEN RAISE EXCEPTION 'template requires owner'; END IF;
 IF p_kind NOT IN ('ad','carousel','motion','landing','caption')
  OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120
  OR p_spec IS NULL OR jsonb_typeof(p_spec)<>'object'
 THEN RAISE EXCEPTION 'invalid creative template'; END IF;
 IF NOT tanaghom.agent_runtime_json_is_safe(p_spec,65536) THEN RAISE EXCEPTION 'unsafe or oversized template spec'; END IF;
 tname:=trim(p_name);
 PERFORM pg_advisory_xact_lock(hashtextextended('creative-template:'||org::text||':'||p_kind||':'||tname,0));
 SELECT coalesce(max(version),0)+1 INTO v FROM tanaghom.creative_templates
  WHERE kind=p_kind AND name=tname AND organization_id=org;
 INSERT INTO tanaghom.creative_templates(organization_id,kind,name,spec,version)
 VALUES(org,p_kind,tname,p_spec,v) RETURNING id INTO made;
 INSERT INTO tanaghom.creative_events(organization_id,actor_user_id,action,payload,result)
 VALUES(org,p_actor,CASE WHEN v=1 THEN 'template_created' ELSE 'template_version_created' END,
  jsonb_build_object('template_id',made,'kind',p_kind,'name',tname,'version',v),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(gen_random_uuid(),p_actor,'creative.template_version_created','creative_template',made,jsonb_build_object('kind',p_kind,'version',v),'success');
 RETURN made;
END $$;

CREATE FUNCTION tanaghom.set_creative_template_active(p_actor uuid,p_template uuid,p_active boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t tanaghom.creative_templates%ROWTYPE; actor_role text; org uuid;
BEGIN
 IF p_template IS NULL OR p_active IS NULL THEN RAISE EXCEPTION 'invalid template activation'; END IF;
 SELECT * INTO t FROM tanaghom.creative_templates WHERE id=p_template;
 IF t.id IS NULL THEN RAISE EXCEPTION 'unknown creative template'; END IF;
 IF t.organization_id IS NULL THEN RAISE EXCEPTION 'global template is read-only'; END IF;
 SELECT app_users.organization_id, app_users.role INTO org, actor_role FROM tanaghom.app_users WHERE id=p_actor AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF org IS NULL OR actor_role<>'owner' THEN RAISE EXCEPTION 'template requires owner'; END IF;
 IF t.organization_id IS NOT NULL AND t.organization_id IS DISTINCT FROM org THEN RAISE EXCEPTION 'cross-tenant template forbidden'; END IF;
 UPDATE tanaghom.creative_templates SET is_active=p_active WHERE id=p_template;
 INSERT INTO tanaghom.creative_events(organization_id,actor_user_id,action,payload,result)
 VALUES(org,p_actor,'template_active_set',jsonb_build_object('template_id',p_template,'active',p_active),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(gen_random_uuid(),p_actor,'creative.template_active_set','creative_template',p_template,jsonb_build_object('active',p_active),'success');
 RETURN p_active;
END $$;

-- Upload pipeline: enqueue + dedicated system-executed transitions in one
-- transaction. Deliberately NOT routed through claim_creative_job(): uploads
-- are application ingestion, not provider-worker execution, so they must
-- work while the runtime emergency stop is closed and must target the exact
-- upload job (never scan the shared queue). Audit/state invariants mirror
-- the worker path. See ADR 0024.
CREATE FUNCTION tanaghom.register_upload_asset(p_actor uuid,p_capability text,p_title text,p_mime text,p_width integer,p_height integer,p_bytes bigint,p_sha256 text,p_object_key text,p_provenance jsonb,p_key uuid,p_correlation uuid)
RETURNS TABLE(o_job_id uuid,o_asset_id uuid,o_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j uuid; ver uuid; asset uuid; org uuid; actor_role text; h text;
BEGIN
 IF p_actor IS NULL OR p_capability NOT IN ('image') OR p_key IS NULL OR p_correlation IS NULL
 THEN RAISE EXCEPTION 'invalid upload registration'; END IF;
 SELECT app_users.organization_id, app_users.role INTO org, actor_role FROM tanaghom.app_users WHERE id=p_actor AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF org IS NULL THEN RAISE EXCEPTION 'unknown or inactive actor'; END IF;
 IF actor_role NOT IN ('owner','operator') THEN RAISE EXCEPTION 'upload requires owner or operator'; END IF;
 IF p_mime NOT IN ('image/png','image/jpeg','image/webp')
  OR (p_width IS NOT NULL AND (p_width NOT BETWEEN 1 AND 8192))
  OR (p_height IS NOT NULL AND (p_height NOT BETWEEN 1 AND 8192))
  OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 10485760
  OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
  OR NOT tanaghom.creative_object_key_is_scoped(p_object_key,org)
  OR p_provenance IS NULL OR jsonb_typeof(p_provenance)<>'object'
 THEN RAISE EXCEPTION 'invalid upload artifact'; END IF;
 h:=tanaghom.agent_runtime_sha256(jsonb_build_array(p_capability,p_title,p_mime,p_bytes,p_sha256,p_object_key));
 PERFORM pg_advisory_xact_lock(hashtextextended('creative:'||org::text||':'||p_key::text,0));
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE organization_id=org AND idempotency_key=p_key;
 IF j IS NULL THEN
  INSERT INTO tanaghom.creative_jobs(organization_id,requested_by,idempotency_key,input_hash,correlation_id,capability,lane,priority,params,max_attempts)
  VALUES(org,p_actor,p_key,h,p_correlation,p_capability,'cpu',0,jsonb_build_object('upload',true),1) RETURNING id INTO j;
  INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
  VALUES(org,j,NULL,'queued','human',p_actor::text,'upload enqueued');
  INSERT INTO tanaghom.creative_events(organization_id,job_id,actor_user_id,action,payload,result)
  VALUES(org,j,p_actor,'job_enqueued',jsonb_build_object('capability',p_capability,'upload',true,'correlation_id',p_correlation),'success');
 ELSE
  IF (SELECT input_hash FROM tanaghom.creative_jobs WHERE id=j) IS DISTINCT FROM h
  THEN RAISE EXCEPTION 'upload idempotency conflict'; END IF;
 END IF;
 UPDATE tanaghom.creative_jobs SET status='claimed',attempt=attempt+1,claimed_by='upload-pipeline',
  lease_expires_at=now()+make_interval(secs=>120),heartbeat_at=now(),started_at=coalesce(started_at,now()),updated_at=now()
  WHERE id=j AND status='queued';
 IF NOT FOUND THEN RAISE EXCEPTION 'upload job not queued'; END IF;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(org,j,'queued','claimed','worker','upload-pipeline','upload ingestion');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(org,j,'job_claimed',jsonb_build_object('worker','upload-pipeline'),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(p_correlation,p_actor,'creative.job_claimed','creative_job',j,jsonb_build_object('worker','upload-pipeline'),'success');
 UPDATE tanaghom.creative_jobs SET status='running',updated_at=now() WHERE id=j;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(org,j,'claimed','running','worker','upload-pipeline','upload ingestion');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,action,payload,result)
 VALUES(org,j,'job_running',jsonb_build_object('worker','upload-pipeline'),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(p_correlation,p_actor,'creative.job_running','creative_job',j,jsonb_build_object('worker','upload-pipeline'),'success');
 INSERT INTO tanaghom.creative_assets(organization_id,capability,title,originating_job_id)
 VALUES(org,p_capability,coalesce(nullif(trim(p_title),''),'Untitled '||p_capability),j) RETURNING id INTO asset;
 INSERT INTO tanaghom.creative_asset_versions(asset_id,version,job_id,title,mime,width,height,bytes,sha256,object_key,provenance,method,status)
 VALUES(asset,1,j,coalesce(nullif(trim(p_title),''),'Untitled '||p_capability),p_mime,p_width,p_height,p_bytes,p_sha256,p_object_key,p_provenance,'upload','draft')
 RETURNING id INTO ver;
 INSERT INTO tanaghom.creative_events(organization_id,job_id,asset_version_id,action,payload,result)
 VALUES(org,j,ver,'asset_created',jsonb_build_object('asset_id',asset,'version',1,'method','upload'),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(p_correlation,p_actor,'creative.asset_version_created','creative_asset_version',ver,jsonb_build_object('asset_id',asset,'method','upload'),'success');
 UPDATE tanaghom.creative_jobs SET status='succeeded',output_asset_ids=array_append(output_asset_ids,asset),finished_at=now(),updated_at=now() WHERE id=j;
 INSERT INTO tanaghom.creative_job_transitions(organization_id,job_id,from_status,to_status,actor_kind,actor_ref,reason)
 VALUES(org,j,'running','succeeded','worker','upload-pipeline','upload artifact persisted');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,asset_version_id,action,payload,result)
 VALUES(org,j,ver,'job_succeeded',jsonb_build_object('worker','upload-pipeline'),'success');
 INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
 VALUES(p_correlation,p_actor,'creative.job_succeeded','creative_job',j,jsonb_build_object('worker','upload-pipeline','asset_version_id',ver),'success');
 INSERT INTO tanaghom.creative_events(organization_id,job_id,asset_version_id,actor_user_id,action,payload,result)
 VALUES(org,j,ver,p_actor,'upload_registered',jsonb_build_object('asset_id',asset),'success');
 RETURN QUERY SELECT j,asset,ver;
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 tanaghom.create_brand_kit(uuid,text,jsonb,jsonb,text,text,jsonb,text,jsonb,jsonb,jsonb),
 tanaghom.create_brand_kit_version(uuid,uuid,jsonb,jsonb,text,text,jsonb,text,jsonb,jsonb,jsonb),
 tanaghom.set_brand_kit_current(uuid,uuid,integer),
 tanaghom.create_creative_template(uuid,text,text,jsonb),
 tanaghom.set_creative_template_active(uuid,uuid,boolean),
 tanaghom.register_upload_asset(uuid,text,text,text,int,int,bigint,text,text,jsonb,uuid,uuid)
TO tanaghom_api;

INSERT INTO public.schema_migrations(version) VALUES ('0037_creative_studio_management');
COMMIT;
