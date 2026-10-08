BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tanaghom.brand_kits) OR EXISTS(SELECT 1 FROM tanaghom.creative_templates)
  OR EXISTS(SELECT 1 FROM tanaghom.creative_jobs WHERE params->>'upload'='true')
 THEN RAISE EXCEPTION 'studio rollback refuses retained brand kits, templates, or upload jobs; stop and use application rollback'; END IF;
END $$;
DROP FUNCTION tanaghom.register_upload_asset(uuid,text,text,text,int,int,bigint,text,text,jsonb,uuid,uuid);
DROP FUNCTION tanaghom.set_creative_template_active(uuid,uuid,boolean);
DROP FUNCTION tanaghom.create_creative_template(uuid,boolean,text,text,jsonb);
DROP FUNCTION tanaghom.set_brand_kit_current(uuid,uuid,integer);
DROP FUNCTION tanaghom.create_brand_kit_version(uuid,uuid,jsonb,jsonb,text,text,jsonb,text,jsonb,jsonb,jsonb);
DROP FUNCTION tanaghom.create_brand_kit(uuid,text,jsonb,jsonb,text,text,jsonb,text,jsonb,jsonb,jsonb);
ALTER TABLE tanaghom.creative_asset_versions DROP CONSTRAINT creative_asset_versions_object_key_unique;
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_constraint
  WHERE conrelid='tanaghom.creative_events'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%upload_registered%';
 IF c IS NULL THEN RAISE EXCEPTION 'creative events v2 action check not found'; END IF;
 EXECUTE format('ALTER TABLE tanaghom.creative_events DROP CONSTRAINT %I',c);
END $$;
ALTER TABLE tanaghom.creative_events ADD CONSTRAINT creative_events_action_check CHECK(action IN (
 'job_enqueued','job_claimed','job_running','job_heartbeat','job_failed','job_requeued',
 'job_succeeded','job_cancel_requested','job_cancelled','job_expired',
 'asset_created','asset_version_created','asset_approved','asset_rejected','control_changed'));
DELETE FROM public.schema_migrations WHERE version='0037_creative_studio_management';
COMMIT;
