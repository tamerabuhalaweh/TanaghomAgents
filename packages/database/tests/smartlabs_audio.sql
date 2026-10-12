\set ON_ERROR_STOP on
-- Only the issue-242 owned disposable fixture. All rows roll back.
BEGIN;
DO $$ BEGIN
 IF NOT tanaghom.creative_object_key_is_scoped('t/24200000-0000-4000-8000-000000000001/voice/24200000-0000-4000-8000-000000000003/v1.ogg','24200000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'SmartLabs controlled audio Ogg key rejected';
 END IF;
 IF tanaghom.creative_object_key_is_scoped('https://example.test/a.ogg','24200000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'URL admitted as controlled key'; END IF;
END $$;
INSERT INTO tanaghom.organizations(id,slug,name,is_active) VALUES('24200000-0000-4000-8000-000000000001','issue242-disposable','Issue242 fixture',true);
INSERT INTO tanaghom.app_users(id,organization_id,email,display_name,kind,role,auth_subject,accepted_at)
 VALUES('24200000-0000-4000-8000-000000000002','24200000-0000-4000-8000-000000000001','fixture242@example.test','Synthetic owner','human','owner','24200000-0000-4000-8000-000000000004',now());
INSERT INTO tanaghom.creative_jobs(id,organization_id,requested_by,idempotency_key,input_hash,correlation_id,capability,lane,status,claimed_by,lease_expires_at)
 VALUES('24200000-0000-4000-8000-000000000003','24200000-0000-4000-8000-000000000001','24200000-0000-4000-8000-000000000002',gen_random_uuid(),'fixture-only',gen_random_uuid(),'voice','gpu_audio','running','issue242-owned-worker',now()+interval '5 minutes');
SET LOCAL ROLE tanaghom_creative_worker;
DO $$ DECLARE mime text; ext text; ver uuid; BEGIN
 FOREACH ext IN ARRAY ARRAY['wav','ogg','flac','aac'] LOOP
  mime:=CASE ext WHEN 'wav' THEN 'audio/wav' WHEN 'ogg' THEN 'audio/ogg' WHEN 'flac' THEN 'audio/flac' ELSE 'audio/aac' END;
  ver:=tanaghom.create_creative_asset_version('24200000-0000-4000-8000-000000000003','issue242-owned-worker',NULL,'Synthetic audio metadata fixture',mime,NULL,NULL,100,100,repeat('a',64),'t/24200000-0000-4000-8000-000000000001/voice/24200000-0000-4000-8000-000000000003/v1.'||ext,NULL,'{"fixture":true}',NULL,NULL,'render');
  IF ver IS NULL THEN RAISE EXCEPTION 'missing audio version'; END IF;
 END LOOP;
 BEGIN
  PERFORM tanaghom.create_creative_asset_version('24200000-0000-4000-8000-000000000003','issue242-owned-worker',NULL,'Bad scope','audio/ogg',NULL,NULL,100,100,repeat('a',64),'t/24200000-0000-4000-8000-000000000099/voice/24200000-0000-4000-8000-000000000003/v1.ogg',NULL,'{}',NULL,NULL,'render');
  RAISE EXCEPTION 'foreign scope incorrectly accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'object key missing tenant scope' THEN RAISE; END IF; END;
 BEGIN
  DELETE FROM tanaghom.creative_assets;
  RAISE EXCEPTION 'worker direct CRUD incorrectly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id=v.asset_id WHERE a.organization_id='24200000-0000-4000-8000-000000000001' AND v.status='draft')<>4 THEN RAISE EXCEPTION 'audio drafts not persisted'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE NOT enabled AND emergency_stop) THEN RAISE EXCEPTION 'fixture changed controls'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS restricted worker controlled audio types, private tenant key scope, draft versions, unchanged controls';
