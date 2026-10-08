\set ON_ERROR_STOP on

-- P2a image-lane assertions. Disposable database only. Runs after
-- creative_foundation.sql + creative_studio.sql; fixture ids are disjoint
-- (90/91/92 prefix range).

INSERT INTO tanaghom.organizations (id, slug, name, is_active) VALUES
 ('90000000-0000-4000-8000-000000000001', 'image-org-a', 'Image Org A', true);

INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
 ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'image-owner-a@example.test', 'Image Owner A', 'human', 'owner', '92000000-0000-4000-8000-000000000001', now()),
 ('91000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', 'image-reviewer-a@example.test', 'Image Reviewer A', 'human', 'reviewer', '92000000-0000-4000-8000-000000000003', now()),
 ('91000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000001', 'image-viewer-a@example.test', 'Image Viewer A', 'human', 'viewer', '92000000-0000-4000-8000-000000000004', now());

UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable image lane test';

-- Provider calls record per-attempt metering with worker identity.
DO $$ DECLARE j uuid; c1 uuid; c2 uuid; BEGIN
 j := tanaghom.create_creative_job('91000000-0000-4000-8000-000000000001','image','gpu_image','{"prompt":"red square"}','93000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',100,3);
 PERFORM tanaghom.claim_creative_job('gpu_image','worker-meter',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-meter' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 PERFORM tanaghom.mark_creative_job_running(j,'worker-meter');
 c1 := tanaghom.record_creative_provider_call(j,'worker-meter','fal-ai','fal-ai/flux/schnell','schnell-20260414','text_to_image',NULL,'{"megapixels":1}',0.003,NULL,0,'started',NULL,NULL);
 c2 := tanaghom.record_creative_provider_call(j,'worker-meter','fal-ai','fal-ai/flux/schnell','schnell-20260414','text_to_image','fal-req-1','{"megapixels":1}',0.003,0.003,0,'succeeded',NULL,NULL);
 IF (SELECT attempt_no FROM tanaghom.creative_provider_calls WHERE id=c2)<>2 THEN RAISE EXCEPTION 'attempt numbering broken'; END IF;
 IF (SELECT count(*) FROM tanaghom.creative_provider_calls WHERE job_id=j)<>2 THEN RAISE EXCEPTION 'provider calls missing'; END IF;
 BEGIN PERFORM tanaghom.record_creative_provider_call(j,'intruder','fal-ai','x',NULL,'text_to_image',NULL,'{}',NULL,NULL,0,'started',NULL,NULL);
 RAISE EXCEPTION 'foreign recorder unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%worker mismatch%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.record_creative_provider_call(j,'worker-meter','fal-ai','x',NULL,'teleport',NULL,'{}',NULL,NULL,0,'started',NULL,NULL);
 RAISE EXCEPTION 'bad operation unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%invalid provider call record%' THEN RAISE; END IF; END;
END $$;

-- Fidelity reviews append history and derive version status.
DO $$ DECLARE j uuid; v uuid; r uuid; BEGIN
 j := tanaghom.create_creative_job('91000000-0000-4000-8000-000000000001','image','cpu','{"prompt":"logo can"}','93000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000002',100,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-fid',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-fid' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 PERFORM tanaghom.mark_creative_job_running(j,'worker-fid');
 v := tanaghom.create_creative_asset_version(j,'worker-fid',NULL,'Logo can','image/png',256,256,NULL,4096,
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','t/90000000-0000-4000-8000-000000000001/image/'||j::text||'/v1.png',NULL,'{"adapter":"local-sharp"}',NULL,NULL,'render');
 PERFORM tanaghom.complete_creative_job(j,'worker-fid',v,NULL);
 r := tanaghom.record_creative_fidelity_review('91000000-0000-4000-8000-000000000003',v,'{"logo":"pass","package_text":"fail","shape":"pass","proportions":"pass","primary_colors":"pass","markings":"unreviewed"}','failed',NULL);
 IF (SELECT fidelity_status FROM tanaghom.creative_asset_versions WHERE id=v)<>'failed' THEN RAISE EXCEPTION 'fidelity status not derived'; END IF;
 r := tanaghom.record_creative_fidelity_review('91000000-0000-4000-8000-000000000001',v,'{"logo":"pass","package_text":"pass","shape":"pass","proportions":"pass","primary_colors":"pass","markings":"pass"}','passed',NULL);
 IF (SELECT count(*) FROM tanaghom.creative_fidelity_reviews WHERE asset_version_id=v)<>2 THEN RAISE EXCEPTION 'review history not appended'; END IF;
 IF (SELECT fidelity_status FROM tanaghom.creative_asset_versions WHERE id=v)<>'passed' THEN RAISE EXCEPTION 'latest review did not win'; END IF;
 BEGIN PERFORM tanaghom.record_creative_fidelity_review('91000000-0000-4000-8000-000000000004',v,'{}','passed',NULL);
 RAISE EXCEPTION 'viewer review unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%owner or reviewer%' THEN RAISE; END IF; END;
 BEGIN UPDATE tanaghom.creative_fidelity_reviews SET overall='failed' WHERE id=r;
 RAISE EXCEPTION 'review rewrite unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END;
END $$;

SELECT 'PASS: creative image lane contract holds.' AS result;
