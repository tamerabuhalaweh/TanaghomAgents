BEGIN;
DO $$ BEGIN IF (SELECT max(version) FROM public.schema_migrations) IS DISTINCT FROM '0046_creative_talking_head' THEN RAISE EXCEPTION '0047 requires exact 0046 baseline'; END IF; END $$;
-- #242: refuse unsafe execution-role baselines; never repair/escalate grants.
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('tanaghom_api','tanaghom_creative_worker') AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls) <> 2
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('tanaghom_api','tanaghom_creative_worker'))
 OR EXISTS(
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='tanaghom' AND c.relkind IN ('r','p')
   AND (c.relname LIKE 'creative\_%' ESCAPE '\' OR c.relname IN ('brand_kits','brand_kit_versions'))
   AND (has_table_privilege('tanaghom_creative_worker',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege('tanaghom_creative_worker',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_table_privilege('tanaghom_api',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege('tanaghom_api',c.oid,'INSERT,UPDATE,REFERENCES'))
 )
 OR has_schema_privilege('tanaghom_creative_worker','tanaghom','CREATE')
 OR has_schema_privilege('tanaghom_api','tanaghom','CREATE')
 OR NOT has_function_privilege('tanaghom_creative_worker','tanaghom.create_creative_asset_version(uuid,text,uuid,text,text,integer,integer,integer,bigint,text,text,text,jsonb,text,text,text)','EXECUTE')
 OR has_function_privilege('tanaghom_api','tanaghom.create_creative_asset_version(uuid,text,uuid,text,text,integer,integer,integer,bigint,text,text,text,jsonb,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION '0047 restricted role baseline required'; END IF;
END $$;
-- #242: existing private audio versions only; no grants, tables, jobs or provider activation.
ALTER TABLE tanaghom.creative_asset_versions DROP CONSTRAINT creative_asset_versions_mime_check;
ALTER TABLE tanaghom.creative_asset_versions ADD CONSTRAINT creative_asset_versions_mime_check CHECK(mime IN ('image/png','image/jpeg','image/webp','video/mp4','audio/wav','audio/mpeg','audio/ogg','audio/flac','audio/aac','text/html'));
CREATE OR REPLACE FUNCTION tanaghom.creative_object_key_is_scoped(p_key text,p_org uuid) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT p_key ~ ('^t/' || p_org::text || '/[a-z_]+/[0-9a-f-]{36}/v[0-9]+\.(png|jpg|jpeg|webp|mp4|wav|mp3|ogg|flac|aac|html)$')
$$;
CREATE OR REPLACE FUNCTION tanaghom.create_creative_asset_version(p_job uuid,p_worker text,p_asset_id uuid,p_title text,p_mime text,p_width integer,p_height integer,p_duration_ms integer,p_bytes bigint,p_sha256 text,p_object_key text,p_thumb_key text,p_provenance jsonb,p_prompt_ref text,p_template_ref text,p_method text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j tanaghom.creative_jobs%ROWTYPE; a uuid; v integer; made uuid;
BEGIN
 IF p_job IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200
  OR (p_title IS NOT NULL AND length(trim(p_title)) NOT BETWEEN 1 AND 200)
  OR p_mime NOT IN ('image/png','image/jpeg','image/webp','video/mp4','audio/wav','audio/mpeg','audio/ogg','audio/flac','audio/aac','text/html')
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
INSERT INTO public.schema_migrations(version) VALUES('0047_smartlabs_audio');
COMMIT;
