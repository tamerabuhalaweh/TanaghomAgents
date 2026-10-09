BEGIN;
DROP FUNCTION tanaghom.claim_creative_design_job(text,int);
DROP FUNCTION tanaghom.get_creative_render_version_asset(uuid,text,uuid);
DROP FUNCTION tanaghom.count_creative_render_outputs(uuid,text);
DROP FUNCTION tanaghom.get_creative_render_source(uuid,text,uuid);
DROP FUNCTION tanaghom.get_creative_render_input(uuid,text);
DELETE FROM public.schema_migrations WHERE version='0039_creative_design_render';
COMMIT;
