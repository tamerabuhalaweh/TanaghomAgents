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
 SELECT * INTO k FROM tanaghom.brand_kits WHERE id=p_kit;
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

-- Template version creation with scope-aware numbering. p_global=true writes a
-- global (NULL-org) row any owner may create; otherwise the actor's org.
CREATE FUNCTION tanaghom.create_creative_template(p_actor uuid,p_global boolean,p_kind text,p_name text,p_spec jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid; actor_role text; scope_org uuid; v integer; made uuid;
BEGIN
 SELECT app_users.organization_id, app_users.role INTO org, actor_role FROM tanaghom.app_users WHERE id=p_actor AND kind='human' AND is_active AND accepted_at IS NOT NULL;
 IF org IS NULL THEN RAISE EXCEPTION 'unknown or inactive actor'; END IF;
 IF actor_role<>'owner' THEN RAISE EXCEPTION 'template requires owner'; END IF;
 IF p_kind NOT IN ('ad','carousel','motion','landing','caption')
  OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120
  OR p_spec IS NULL OR jsonb_typeof(p_spec)<>'object'
 THEN RAISE EXCEPTION 'invalid creative template'; END IF;
 IF NOT tanaghom.agent_runtime_json_is_safe(p_spec,65536) THEN RAISE EXCEPTION 'unsafe or oversized template spec'; END IF;
 scope_org:=CASE WHEN coalesce(p_global,false) THEN NULL ELSE org END;
 SELECT coalesce(max(version),0)+1 INTO v FROM tanaghom.creative_templates
  WHERE kind=p_kind AND name=trim(p_name) AND organization_id IS NOT DISTINCT FROM scope_org;
 INSERT INTO tanaghom.creative_templates(organization_id,kind,name,spec,version)
 VALUES(scope_org,p_kind,trim(p_name),p_spec,v) RETURNING id INTO made;
 INSERT INTO tanaghom.creative_events(organization_id,actor_user_id,action,payload,result)
 VALUES(org,p_actor,CASE WHEN v=1 THEN 'template_created' ELSE 'template_version_created' END,
  jsonb_build_object('template_id',made,'kind',p_kind,'name',trim(p_name),'version',v,'global',scope_org IS NULL),'success');
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

-- Upload pipeline: enqueue + system-executed claim/run/register/complete in one
-- transaction. The only path that materializes user bytes as versions.
CREATE FUNCTION tanaghom.register_upload_asset(p_actor uuid,p_capability text,p_title text,p_mime text,p_width integer,p_height integer,p_bytes bigint,p_sha256 text,p_object_key text,p_provenance jsonb,p_key uuid,p_correlation uuid)
RETURNS TABLE(o_job_id uuid,o_asset_id uuid,o_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j uuid; claimed uuid; ver uuid; asset uuid;
BEGIN
 IF p_actor IS NULL OR p_capability NOT IN ('image') OR p_key IS NULL OR p_correlation IS NULL
 THEN RAISE EXCEPTION 'invalid upload registration'; END IF;
 SELECT tanaghom.create_creative_job(p_actor,p_capability,'cpu',jsonb_build_object('upload',true),p_key,p_correlation,100,1,NULL,NULL,NULL) INTO j;
 PERFORM tanaghom.claim_creative_job('cpu','upload-pipeline',120);
 SELECT id INTO claimed FROM tanaghom.creative_jobs WHERE claimed_by='upload-pipeline' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 IF claimed IS DISTINCT FROM j THEN RAISE EXCEPTION 'upload claim contention'; END IF;
 PERFORM tanaghom.mark_creative_job_running(j,'upload-pipeline');
 SELECT tanaghom.create_creative_asset_version(j,'upload-pipeline',NULL,p_title,p_mime,p_width,p_height,NULL,p_bytes,p_sha256,p_object_key,NULL,p_provenance,NULL,NULL,'upload') INTO ver;
 SELECT asset_id INTO asset FROM tanaghom.creative_asset_versions WHERE id=ver;
 PERFORM tanaghom.complete_creative_job(j,'upload-pipeline',ver,NULL);
 INSERT INTO tanaghom.creative_events(organization_id,job_id,asset_version_id,actor_user_id,action,payload,result)
 SELECT organization_id,j,ver,p_actor,'upload_registered',jsonb_build_object('asset_id',asset),'success' FROM tanaghom.creative_jobs WHERE id=j;
 RETURN QUERY SELECT j,asset,ver;
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 tanaghom.create_brand_kit(uuid,text,jsonb,jsonb,text,text,jsonb,text,jsonb,jsonb,jsonb),
 tanaghom.create_brand_kit_version(uuid,uuid,jsonb,jsonb,text,text,jsonb,text,jsonb,jsonb,jsonb),
 tanaghom.set_brand_kit_current(uuid,uuid,integer),
 tanaghom.create_creative_template(uuid,boolean,text,text,jsonb),
 tanaghom.set_creative_template_active(uuid,uuid,boolean),
 tanaghom.register_upload_asset(uuid,text,text,text,int,int,bigint,text,text,jsonb,uuid,uuid)
TO tanaghom_api;

INSERT INTO public.schema_migrations(version) VALUES ('0037_creative_studio_management');
COMMIT;
