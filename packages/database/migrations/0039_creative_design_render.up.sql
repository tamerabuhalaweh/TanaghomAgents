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

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tanaghom FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tanaghom.get_creative_render_input(uuid,text) TO tanaghom_api, tanaghom_creative_worker;

INSERT INTO public.schema_migrations(version) VALUES ('0039_creative_design_render');
COMMIT;
