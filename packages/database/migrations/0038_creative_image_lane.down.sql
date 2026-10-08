BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tanaghom.creative_provider_calls) OR EXISTS(SELECT 1 FROM tanaghom.creative_fidelity_reviews)
  OR EXISTS(SELECT 1 FROM tanaghom.creative_asset_versions WHERE fidelity_status IS DISTINCT FROM 'not_reviewed')
 THEN RAISE EXCEPTION 'image lane rollback refuses retained provider or fidelity evidence; stop and use application rollback'; END IF;
END $$;
DROP FUNCTION tanaghom.record_creative_fidelity_review(uuid,uuid,jsonb,text,text);
DROP FUNCTION tanaghom.finish_creative_provider_call(uuid,text,text,numeric,text,text,text);
DROP FUNCTION tanaghom.begin_creative_provider_call(uuid,text,text,text,text,text,jsonb,numeric,text);
DROP FUNCTION tanaghom.latest_creative_provider_call(uuid,text,text);
ALTER TABLE tanaghom.creative_asset_versions DROP COLUMN fidelity_status;
DROP TABLE tanaghom.creative_fidelity_reviews, tanaghom.creative_provider_calls;
DELETE FROM public.schema_migrations WHERE version='0038_creative_image_lane';
COMMIT;
