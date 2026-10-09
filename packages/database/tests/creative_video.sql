\set ON_ERROR_STOP on

-- P4 video-lane assertions. Disposable database only. Widevine-free zone:
-- no credentials, no provider contact, all controlled functions.

INSERT INTO tanaghom.organizations (id, slug, name, is_active) VALUES
 ('e0000000-0000-4000-8000-000000000001', 'video-org-a', 'Video Org A', true),
 ('e0000000-0000-4000-8000-000000000002', 'video-org-b', 'Video Org B', true);

INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
 ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'video-owner-a@example.test', 'Video Owner A', 'human', 'owner', 'e2000000-0000-4000-8000-000000000001', now()),
 ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'video-operator-a@example.test', 'Video Operator A', 'human', 'operator', 'e2000000-0000-4000-8000-000000000002', now()),
 ('e1000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000002', 'video-owner-b@example.test', 'Video Owner B', 'human', 'owner', 'e2000000-0000-4000-8000-000000001011', now());

UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable video lane test';

-- Happy path: worker-claimed video job resolves input params.
DO $$ DECLARE j uuid; input jsonb; BEGIN
 j := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','video','gpu_video',
  '{"operation":"text_to_video","prompt":"dunes","duration":5,"resolution":"768P","ratio":"16:9"}',
  'e5000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',0,3);
 PERFORM tanaghom.claim_creative_video_job('worker-video',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-video' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.get_creative_video_input(j,'worker-video') INTO input;
 IF input->>'capability' IS DISTINCT FROM 'video' THEN RAISE EXCEPTION 'wrong capability'; END IF;
 IF input->>'lane' IS DISTINCT FROM 'gpu_video' THEN RAISE EXCEPTION 'wrong lane'; END IF;
 IF input->'params'->>'operation' IS DISTINCT FROM 'text_to_video' THEN RAISE EXCEPTION 'params missing'; END IF;
END $$;

-- Foreign worker, unknown job, non-video capability.
DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','video','gpu_video',
  '{"operation":"text_to_video","prompt":"x","duration":5}','e5000000-0000-4000-8000-000000000002','e6000000-0000-4000-8000-000000000002',0,3);
 PERFORM tanaghom.claim_creative_video_job('worker-video-2',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-video-2' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_video_input(j,'intruder');
 RAISE EXCEPTION 'foreign read unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%worker mismatch%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.get_creative_video_input('e5000000-0000-4000-8000-000000000099','worker-video-2');
 RAISE EXCEPTION 'unknown job unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%unknown creative job%' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','image','cpu','{}','e5000000-0000-4000-8000-000000000003','e6000000-0000-4000-8000-000000000003',0,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-video-3',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-video-3' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_video_input(j,'worker-video-3');
 RAISE EXCEPTION 'non-video input unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%not a video generation job%' THEN RAISE; END IF; END;
END $$;

-- Capability-filtered claim: an older image GPU job is never touched;
-- priority holds among video jobs; no double-claim.
DO $$ DECLARE old_image uuid; v1 uuid; v2 uuid; got uuid; BEGIN
 old_image := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','image','gpu_video','{}',
  'e5000000-0000-4000-8000-000000000011','e6000000-0000-4000-8000-000000000011',0,3);
 v1 := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','video','gpu_video',
  '{"operation":"text_to_video","prompt":"a","duration":5}','e5000000-0000-4000-8000-000000000012','e6000000-0000-4000-8000-000000000012',0,3);
 v2 := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','video','gpu_video',
  '{"operation":"text_to_video","prompt":"b","duration":5}','e5000000-0000-4000-8000-000000000013','e6000000-0000-4000-8000-000000000013',100,3);
 SELECT job_id INTO got FROM tanaghom.claim_creative_video_job('worker-video-filter-1',120);
 IF got IS DISTINCT FROM v2 THEN RAISE EXCEPTION 'filtered claim missed priority video job'; END IF;
 SELECT job_id INTO got FROM tanaghom.claim_creative_video_job('worker-video-filter-2',120);
 IF got IS DISTINCT FROM v1 THEN RAISE EXCEPTION 'filtered claim missed second video job'; END IF;
 SELECT job_id INTO got FROM tanaghom.claim_creative_video_job('worker-video-filter-3',120);
 IF got IS NOT NULL THEN RAISE EXCEPTION 'filtered claim touched a foreign job'; END IF;
 PERFORM 1 FROM tanaghom.creative_jobs WHERE id=old_image AND status='queued' AND claimed_by IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'image job was claimed or moved'; END IF;
END $$;

-- Source resolution: same-org source resolves, cross-tenant fails closed.
DO $$ DECLARE j uuid; v uuid; src jsonb; BEGIN
 j := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','video','gpu_video',
  '{"operation":"image_to_video","prompt":"x","duration":5}','e5000000-0000-4000-8000-000000000014','e6000000-0000-4000-8000-000000000014',0,3);
 PERFORM tanaghom.claim_creative_video_job('worker-video-src',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-video-src' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.create_creative_asset_version(j,'worker-video-src',NULL,'src','image/png',64,64,NULL,100,
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  't/e0000000-0000-4000-8000-000000000001/image/' || j::text || '/v1.png',NULL,'{}',NULL,'s','upload') INTO v;
 SELECT tanaghom.get_creative_video_source(j,'worker-video-src',v) INTO src;
 IF src->>'mime' IS DISTINCT FROM 'image/png' THEN RAISE EXCEPTION 'source resolve failed'; END IF;
 BEGIN PERFORM tanaghom.get_creative_video_source(j,'intruder',v);
 RAISE EXCEPTION 'foreign source read unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%worker mismatch%' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE jb uuid; v uuid; j uuid; BEGIN
 jb := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000011','image','cpu','{}','e5000000-0000-4000-8000-000000000015','e6000000-0000-4000-8000-000000000015',0,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-video-src-b',120);
 SELECT id INTO jb FROM tanaghom.creative_jobs WHERE claimed_by='worker-video-src-b' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.create_creative_asset_version(jb,'worker-video-src-b',NULL,'srcb','image/png',64,64,NULL,100,
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  't/e0000000-0000-4000-8000-000000000002/image/' || jb::text || '/v1.png',NULL,'{}',NULL,'s','upload') INTO v;
 j := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','video','gpu_video',
  '{"operation":"image_to_video","prompt":"x","duration":5}','e5000000-0000-4000-8000-000000000016','e6000000-0000-4000-8000-000000000016',0,3);
 PERFORM tanaghom.claim_creative_video_job('worker-video-src-2',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-video-src-2' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_video_source(j,'worker-video-src-2',v);
 RAISE EXCEPTION 'cross-tenant source unexpectedly resolved'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%video source not found%' THEN RAISE; END IF; END;
END $$;

-- Provider-call widening: video operations meter; blind-retry lookup works.
DO $$ DECLARE j uuid; call uuid; call_status text; BEGIN
 j := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','video','gpu_video',
  '{"operation":"text_to_video","prompt":"x","duration":5}','e5000000-0000-4000-8000-000000000017','e6000000-0000-4000-8000-000000000017',0,3);
 PERFORM tanaghom.claim_creative_video_job('worker-video-call',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-video-call' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.begin_creative_provider_call(j,'worker-video-call','minimax','MiniMax-H3',NULL,'text_to_video','{"seconds":5}',0.4,'creative.video-providers.v1') INTO call;
 SELECT tanaghom.latest_creative_provider_call(j,'worker-video-call','text_to_video') INTO call_status;
 IF call_status IS DISTINCT FROM 'started' THEN RAISE EXCEPTION 'latest call lookup failed'; END IF;
 PERFORM tanaghom.finish_creative_provider_call(call,'worker-video-call','task-1',0.4,'indeterminate','indeterminate','timeout at create');
 SELECT tanaghom.latest_creative_provider_call(j,'worker-video-call','text_to_video') INTO call_status;
 IF call_status IS DISTINCT FROM 'indeterminate' THEN RAISE EXCEPTION 'indeterminate finish failed'; END IF;
 BEGIN PERFORM tanaghom.begin_creative_provider_call(j,'worker-video-call','minimax','MiniMax-H3',NULL,'lip_sync','{}',0.1,'x');
 RAISE EXCEPTION 'out-of-scope operation unexpectedly metered'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%invalid provider call begin%' THEN RAISE; END IF; END;
END $$;

-- Provider request anchor: attach once, same-value idempotent,
-- replacement rejected, non-started rejected, full record readable.
DO $$ DECLARE j uuid; call uuid; rec jsonb; BEGIN
 j := tanaghom.create_creative_job('e1000000-0000-4000-8000-000000000001','video','gpu_video',
  '{"operation":"text_to_video","prompt":"x","duration":5}','e5000000-0000-4000-8000-000000000018','e6000000-0000-4000-8000-000000000018',0,3);
 PERFORM tanaghom.claim_creative_video_job('worker-video-anchor',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-video-anchor' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.begin_creative_provider_call(j,'worker-video-anchor','minimax','MiniMax-H3',NULL,'text_to_video','{"seconds":5}',0.4,'creative.video-providers.v1') INTO call;
 SELECT tanaghom.get_creative_provider_call(j,'worker-video-anchor','text_to_video') INTO rec;
 IF rec->>'status' IS DISTINCT FROM 'started' THEN RAISE EXCEPTION 'call record wrong'; END IF;
 IF rec->>'provider_request_id' IS NOT NULL THEN RAISE EXCEPTION 'request id should start null'; END IF;
 PERFORM tanaghom.attach_creative_provider_request(call,'worker-video-anchor','task-abc-1');
 PERFORM tanaghom.attach_creative_provider_request(call,'worker-video-anchor','task-abc-1');
 SELECT tanaghom.get_creative_provider_call(j,'worker-video-anchor','text_to_video') INTO rec;
 IF rec->>'provider_request_id' IS DISTINCT FROM 'task-abc-1' THEN RAISE EXCEPTION 'anchor not persisted'; END IF;
 IF (rec->>'attempt_no')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'attempt number wrong'; END IF;
 BEGIN PERFORM tanaghom.attach_creative_provider_request(call,'worker-video-anchor','task-other');
 RAISE EXCEPTION 'request replacement unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%already attached%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.attach_creative_provider_request(call,'intruder','task-abc-1');
 RAISE EXCEPTION 'foreign attach unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%worker mismatch%' THEN RAISE; END IF; END;
 PERFORM tanaghom.finish_creative_provider_call(call,'worker-video-anchor','task-abc-1',0.4,'succeeded',NULL,NULL);
 BEGIN PERFORM tanaghom.attach_creative_provider_request(call,'worker-video-anchor','task-abc-1');
 RAISE EXCEPTION 'terminal attach unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%already terminal%' THEN RAISE; END IF; END;
 SELECT tanaghom.get_creative_provider_call(j,'worker-video-anchor','image_to_video') INTO rec;
 IF rec IS NOT NULL THEN RAISE EXCEPTION 'missing operation should return null'; END IF;
END $$;

-- Least-privilege boundary: the worker role stays EXECUTE-only.
SET ROLE tanaghom_creative_worker;
DO $$ BEGIN
 BEGIN PERFORM * FROM tanaghom.creative_jobs LIMIT 1;
 RAISE EXCEPTION 'worker job select unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN END;
 BEGIN PERFORM * FROM tanaghom.creative_asset_versions LIMIT 1;
 RAISE EXCEPTION 'worker version select unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN END;
END $$;
RESET ROLE;

SELECT 'PASS: creative video lane contract holds.' AS result;
