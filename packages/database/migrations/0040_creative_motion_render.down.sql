BEGIN;
DROP FUNCTION tanaghom.get_creative_motion_state(uuid,text);
DROP FUNCTION tanaghom.claim_creative_motion_job(text,int);
DROP FUNCTION tanaghom.get_creative_motion_input(uuid,text);
DELETE FROM public.schema_migrations WHERE version='0040_creative_motion_render';
COMMIT;
