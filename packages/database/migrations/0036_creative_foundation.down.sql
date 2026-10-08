BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tanaghom.creative_jobs WHERE status NOT IN ('queued','cancelled','expired') OR cancel_requested)
  OR EXISTS(SELECT 1 FROM tanaghom.creative_assets) OR EXISTS(SELECT 1 FROM tanaghom.creative_asset_versions)
  OR EXISTS(SELECT 1 FROM tanaghom.creative_job_transitions) OR EXISTS(SELECT 1 FROM tanaghom.creative_events)
  OR EXISTS(SELECT 1 FROM tanaghom.brand_kits) OR EXISTS(SELECT 1 FROM tanaghom.brand_kit_versions)
  OR EXISTS(SELECT 1 FROM tanaghom.creative_templates)
  OR EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE enabled OR NOT emergency_stop)
 THEN RAISE EXCEPTION 'creative rollback refuses retained jobs, assets, templates, brand kits, events or enabled runtime; stop and use application rollback'; END IF;
END $$;
DROP FUNCTION tanaghom.set_creative_control(uuid,boolean,boolean,text);
DROP FUNCTION tanaghom.decide_creative_asset_version(uuid,uuid,text,text);
DROP FUNCTION tanaghom.create_creative_asset_version(uuid,text,uuid,text,text,int,int,int,bigint,text,text,text,jsonb,text,text,text);
DROP FUNCTION tanaghom.expire_creative_leases();
DROP FUNCTION tanaghom.request_creative_cancel(uuid,uuid);
DROP FUNCTION tanaghom.fail_creative_job(uuid,text,text,text,int);
DROP FUNCTION tanaghom.complete_creative_job(uuid,text,uuid,int);
DROP FUNCTION tanaghom.heartbeat_creative_job(uuid,text,int);
DROP FUNCTION tanaghom.mark_creative_job_running(uuid,text);
DROP FUNCTION tanaghom.claim_creative_job(text,text,int);
DROP FUNCTION tanaghom.create_creative_job(uuid,text,text,jsonb,uuid,uuid,int,int,text,uuid,int);
DROP FUNCTION tanaghom.creative_object_key_is_scoped(text,uuid);
DROP TABLE tanaghom.creative_events,tanaghom.brand_kit_versions,tanaghom.brand_kits,tanaghom.creative_templates,tanaghom.creative_asset_versions,tanaghom.creative_assets,tanaghom.creative_job_transitions,tanaghom.creative_jobs,tanaghom.creative_controls;
DROP FUNCTION tanaghom.guard_creative_asset_version();
DELETE FROM public.schema_migrations WHERE version='0036_creative_foundation';
COMMIT;
