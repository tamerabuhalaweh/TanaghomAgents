BEGIN;
DROP FUNCTION tanaghom.get_creative_render_input(uuid,text);
DELETE FROM public.schema_migrations WHERE version='0039_creative_design_render';
COMMIT;
