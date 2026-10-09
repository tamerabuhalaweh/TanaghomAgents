\set ON_ERROR_STOP on

-- P2a segmentation follow-up assertions. Disposable database only.

INSERT INTO tanaghom.organizations (id, slug, name, is_active) VALUES
 ('f0000000-0000-4000-8000-000000000001', 'segment-org-a', 'Segment Org A', true),
 ('f0000000-0000-4000-8000-000000000002', 'segment-org-b', 'Segment Org B', true);

INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
 ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'segment-owner-a@example.test', 'Segment Owner A', 'human', 'owner', 'f2000000-0000-4000-8000-000000000001', now()),
 ('f1000000-0000-4000-8000-000000000011', 'f0000000-0000-4000-8000-000000000002', 'segment-owner-b@example.test', 'Segment Owner B', 'human', 'owner', 'f2000000-0000-4000-8000-000000001011', now());

UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable segment test';

-- Happy path: worker-claimed segment job resolves input params.
DO $$ DECLARE j uuid; input jsonb; BEGIN
 j := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000001','product_shoot','cpu',
  '{"operation":"segment","source_asset_version_id":"f7000000-0000-4000-8000-000000000001","engine":"local-deterministic"}',
  'f5000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001',0,3);
 PERFORM tanaghom.claim_creative_segment_job('worker-segment',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-segment' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.get_creative_segment_input(j,'worker-segment') INTO input;
 IF input->>'capability' IS DISTINCT FROM 'product_shoot' THEN RAISE EXCEPTION 'wrong capability'; END IF;
 IF input->'params'->>'operation' IS DISTINCT FROM 'segment' THEN RAISE EXCEPTION 'params missing'; END IF;
 IF (SELECT tanaghom.get_creative_segment_state(j,'worker-segment')->>'cancel_requested') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'cancel state wrong'; END IF;
END $$;

-- Foreign worker, unknown job, non-segment job.
DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000001','product_shoot','cpu',
  '{"operation":"segment"}','f5000000-0000-4000-8000-000000000002','f6000000-0000-4000-8000-000000000002',0,3);
 PERFORM tanaghom.claim_creative_segment_job('worker-segment-2',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-segment-2' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_segment_input(j,'intruder');
 RAISE EXCEPTION 'foreign read unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%worker mismatch%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.get_creative_segment_input('f5000000-0000-4000-8000-000000000099','worker-segment-2');
 RAISE EXCEPTION 'unknown job unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%unknown creative job%' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000001','image','cpu','{}','f5000000-0000-4000-8000-000000000003','f6000000-0000-4000-8000-000000000003',0,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-segment-3',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-segment-3' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_segment_input(j,'worker-segment-3');
 RAISE EXCEPTION 'non-segment input unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%not a segmentation job%' THEN RAISE; END IF; END;
END $$;

-- Capability-filtered claim: an older compose (product_shoot/cpu, other
-- operation) job is never touched; priority holds; no double-claim.
DO $$ DECLARE compose uuid; s1 uuid; s2 uuid; got uuid; BEGIN
 compose := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000001','product_shoot','cpu',
  '{"operation":"compose","preset":"clean_white"}','f5000000-0000-4000-8000-000000000011','f6000000-0000-4000-8000-000000000011',0,3);
 s1 := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000001','product_shoot','cpu',
  '{"operation":"segment"}','f5000000-0000-4000-8000-000000000012','f6000000-0000-4000-8000-000000000012',0,3);
 s2 := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000001','product_shoot','cpu',
  '{"operation":"segment"}','f5000000-0000-4000-8000-000000000013','f6000000-0000-4000-8000-000000000013',100,3);
 SELECT job_id INTO got FROM tanaghom.claim_creative_segment_job('worker-segment-filter-1',120);
 IF got IS DISTINCT FROM s2 THEN RAISE EXCEPTION 'filtered claim missed priority segment job'; END IF;
 SELECT job_id INTO got FROM tanaghom.claim_creative_segment_job('worker-segment-filter-2',120);
 IF got IS DISTINCT FROM s1 THEN RAISE EXCEPTION 'filtered claim missed second segment job'; END IF;
 SELECT job_id INTO got FROM tanaghom.claim_creative_segment_job('worker-segment-filter-3',120);
 IF got IS NOT NULL THEN RAISE EXCEPTION 'filtered claim touched a foreign job'; END IF;
 PERFORM 1 FROM tanaghom.creative_jobs WHERE id=compose AND status='queued' AND claimed_by IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'compose job was claimed or moved'; END IF;
END $$;

-- Source resolution: same-org source resolves, cross-tenant fails closed.
DO $$ DECLARE j uuid; v uuid; src jsonb; BEGIN
 j := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000001','product_shoot','cpu',
  '{"operation":"segment"}','f5000000-0000-4000-8000-000000000014','f6000000-0000-4000-8000-000000000014',0,3);
 PERFORM tanaghom.claim_creative_segment_job('worker-segment-src',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-segment-src' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.create_creative_asset_version(j,'worker-segment-src',NULL,'src','image/png',64,64,NULL,100,
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  't/f0000000-0000-4000-8000-000000000001/image/' || j::text || '/v1.png',NULL,'{}',NULL,'s','upload') INTO v;
 SELECT tanaghom.get_creative_segment_source(j,'worker-segment-src',v) INTO src;
 IF src->>'mime' IS DISTINCT FROM 'image/png' THEN RAISE EXCEPTION 'source resolve failed'; END IF;
 BEGIN PERFORM tanaghom.get_creative_segment_source(j,'intruder',v);
 RAISE EXCEPTION 'foreign source read unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%worker mismatch%' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE jb uuid; v uuid; j uuid; BEGIN
 jb := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000011','image','cpu','{}','f5000000-0000-4000-8000-000000000015','f6000000-0000-4000-8000-000000000015',100,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-segment-src-b',120);
 SELECT id INTO jb FROM tanaghom.creative_jobs WHERE claimed_by='worker-segment-src-b' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.create_creative_asset_version(jb,'worker-segment-src-b',NULL,'srcb','image/png',64,64,NULL,100,
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  't/f0000000-0000-4000-8000-000000000002/image/' || jb::text || '/v1.png',NULL,'{}',NULL,'s','upload') INTO v;
 j := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000001','product_shoot','cpu',
  '{"operation":"segment"}','f5000000-0000-4000-8000-000000000016','f6000000-0000-4000-8000-000000000016',0,3);
 PERFORM tanaghom.claim_creative_segment_job('worker-segment-src-2',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-segment-src-2' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_segment_source(j,'worker-segment-src-2',v);
 RAISE EXCEPTION 'cross-tenant source unexpectedly resolved'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%segment source not found%' THEN RAISE; END IF; END;
END $$;

-- Method vocabulary widening: segment versions register.
DO $$ DECLARE j uuid; v uuid; BEGIN
 j := tanaghom.create_creative_job('f1000000-0000-4000-8000-000000000001','product_shoot','cpu',
  '{"operation":"segment"}','f5000000-0000-4000-8000-000000000017','f6000000-0000-4000-8000-000000000017',0,3);
 PERFORM tanaghom.claim_creative_segment_job('worker-segment-method',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-segment-method' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.create_creative_asset_version(j,'worker-segment-method',NULL,'m','image/png',64,64,NULL,100,
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  't/f0000000-0000-4000-8000-000000000001/product_shoot/' || j::text || '/v1.png',NULL,'{}',NULL,'t','segment') INTO v;
 IF v IS NULL THEN RAISE EXCEPTION 'segment method registration failed'; END IF;
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

SELECT 'PASS: creative segmentation contract holds.' AS result;
