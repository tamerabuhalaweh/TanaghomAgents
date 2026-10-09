\set ON_ERROR_STOP on

-- P3 motion render-input, filtered claim, and worker-boundary assertions.
-- Disposable database only.

INSERT INTO tanaghom.organizations (id, slug, name, is_active) VALUES
 ('d0000000-0000-4000-8000-000000000001', 'motion-org-a', 'Motion Org A', true),
 ('d0000000-0000-4000-8000-000000000002', 'motion-org-b', 'Motion Org B', true);

INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
 ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'motion-owner-a@example.test', 'Motion Owner A', 'human', 'owner', 'd2000000-0000-4000-8000-000000000001', now()),
 ('d1000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000002', 'motion-owner-b@example.test', 'Motion Owner B', 'human', 'owner', 'd2000000-0000-4000-8000-000000001011', now());

INSERT INTO tanaghom.creative_templates(id,organization_id,kind,name,spec,version,is_active) VALUES
 ('d4000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','ad','motion-src-ad',
  '{"locale":"ar","direction":"rtl","canvas":{"width":1080,"height":1080},"nodes":[{"id":"h1","type":"text","x":90,"y":120,"width":900,"height":220,"text":"T"}]}',1,true),
 ('d4000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','motion','motion-ar-fade',
  '{"kind":"motion","locale":"ar","direction":"rtl","design_template_id":"d4000000-0000-4000-8000-000000000001","design_version":1,"fps":24,"scenes":[{"id":"s1","page_id":"page-1","duration_ms":2000}],"elements":[{"node_id":"h1","preset":"fade"}]}',1,true);

UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable motion render test';

-- Happy path: worker-claimed motion job resolves motion, pinned design, params.
DO $$ DECLARE j uuid; input jsonb; BEGIN
 j := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','motion','cpu',
  '{"motion_template_id":"d4000000-0000-4000-8000-000000000002","motion_version":1,"format":"1:1"}',
  'd5000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001',0,3);
 PERFORM tanaghom.claim_creative_motion_job('worker-motion',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-motion' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.get_creative_motion_input(j,'worker-motion') INTO input;
 IF input->>'capability' IS DISTINCT FROM 'motion' THEN RAISE EXCEPTION 'wrong capability'; END IF;
 IF input->'motion'->>'id' IS DISTINCT FROM 'd4000000-0000-4000-8000-000000000002' THEN RAISE EXCEPTION 'wrong motion template'; END IF;
 IF input->'design'->>'id' IS DISTINCT FROM 'd4000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'design not pinned'; END IF;
 IF jsonb_array_length(input->'source_assets') IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'unexpected sources'; END IF;
 IF input->'params'->>'format' IS DISTINCT FROM '1:1' THEN RAISE EXCEPTION 'params missing'; END IF;
 IF (SELECT tanaghom.get_creative_motion_state(j,'worker-motion')->>'cancel_requested') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'cancel state wrong'; END IF;
END $$;

-- Foreign worker, unknown job, non-motion capability, version skew, unknown design.
DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','motion','cpu',
  '{"motion_template_id":"d4000000-0000-4000-8000-000000000002"}','d5000000-0000-4000-8000-000000000002','d6000000-0000-4000-8000-000000000002',0,3);
 PERFORM tanaghom.claim_creative_motion_job('worker-motion-2',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-motion-2' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_motion_input(j,'intruder');
 RAISE EXCEPTION 'foreign motion read unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%worker mismatch%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.get_creative_motion_input('d5000000-0000-4000-8000-000000000099','worker-motion-2');
 RAISE EXCEPTION 'unknown job unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%unknown creative job%' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','design','cpu','{}','d5000000-0000-4000-8000-000000000003','d6000000-0000-4000-8000-000000000003',0,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-motion-3',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-motion-3' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_motion_input(j,'worker-motion-3');
 RAISE EXCEPTION 'non-motion input unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%not a motion render job%' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','motion','cpu',
  '{"motion_template_id":"d4000000-0000-4000-8000-000000000002","motion_version":7}','d5000000-0000-4000-8000-000000000004','d6000000-0000-4000-8000-000000000004',0,3);
 PERFORM tanaghom.claim_creative_motion_job('worker-motion-4',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-motion-4' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_motion_input(j,'worker-motion-4');
 RAISE EXCEPTION 'version skew unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%motion version mismatch%' THEN RAISE; END IF; END;
END $$;

-- Source resolution: same-org source resolves, cross-tenant source fails closed.
DO $$ DECLARE j1 uuid; v uuid; jm uuid; input jsonb; BEGIN
 j1 := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','design','cpu','{}','d5000000-0000-4000-8000-000000000005','d6000000-0000-4000-8000-000000000005',0,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-motion-src',120);
 SELECT id INTO j1 FROM tanaghom.creative_jobs WHERE claimed_by='worker-motion-src' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.create_creative_asset_version(j1,'worker-motion-src',NULL,'src','image/png',64,64,NULL,100,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  't/d0000000-0000-4000-8000-000000000001/image/' || j1::text || '/v1.png',NULL,'{}',NULL,'s','upload') INTO v;
 INSERT INTO tanaghom.creative_templates(id,organization_id,kind,name,spec,version,is_active) VALUES
  ('d4000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','ad','motion-src-photo',
   ('{"locale":"en","direction":"ltr","canvas":{"width":1080,"height":1080},"nodes":[{"id":"p1","type":"image","x":90,"y":120,"width":500,"height":500,"asset_version_id":"' || v::text || '"}]}')::jsonb,1,true),
  ('d4000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','motion','motion-photo',
   '{"kind":"motion","locale":"en","direction":"ltr","design_template_id":"d4000000-0000-4000-8000-000000000003","design_version":1,"fps":24,"scenes":[{"id":"s1","page_id":"page-1","duration_ms":1000}],"elements":[{"node_id":"p1","preset":"fade"}]}',1,true);
 jm := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','motion','cpu',
  '{"motion_template_id":"d4000000-0000-4000-8000-000000000004"}','d5000000-0000-4000-8000-000000000006','d6000000-0000-4000-8000-000000000006',0,3);
 PERFORM tanaghom.claim_creative_motion_job('worker-motion-src-2',120);
 SELECT id INTO jm FROM tanaghom.creative_jobs WHERE claimed_by='worker-motion-src-2' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.get_creative_motion_input(jm,'worker-motion-src-2') INTO input;
 IF jsonb_array_length(input->'source_assets') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'source not resolved'; END IF;
 IF input->'source_assets'->0->>'mime' IS DISTINCT FROM 'image/png' THEN RAISE EXCEPTION 'source mime wrong'; END IF;
END $$;

DO $$ DECLARE jb uuid; jm uuid; BEGIN
 jb := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000011','design','cpu','{}','d5000000-0000-4000-8000-000000000007','d6000000-0000-4000-8000-000000000007',0,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-motion-src-b',120);
 SELECT id INTO jb FROM tanaghom.creative_jobs WHERE claimed_by='worker-motion-src-b' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.create_creative_asset_version(jb,'worker-motion-src-b',NULL,'srcb','image/png',64,64,NULL,100,
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  't/d0000000-0000-4000-8000-000000000002/image/' || jb::text || '/v1.png',NULL,'{}',NULL,'s','upload') INTO jb;
 INSERT INTO tanaghom.creative_templates(id,organization_id,kind,name,spec,version,is_active) VALUES
  ('d4000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','ad','motion-src-foreign',
   ('{"locale":"en","direction":"ltr","canvas":{"width":1080,"height":1080},"nodes":[{"id":"p1","type":"image","x":90,"y":120,"width":500,"height":500,"asset_version_id":"' || jb::text || '"}]}')::jsonb,1,true),
  ('d4000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','motion','motion-foreign',
   '{"kind":"motion","locale":"en","direction":"ltr","design_template_id":"d4000000-0000-4000-8000-000000000005","design_version":1,"fps":24,"scenes":[{"id":"s1","page_id":"page-1","duration_ms":1000}],"elements":[{"node_id":"p1","preset":"fade"}]}',1,true);
 jm := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','motion','cpu',
  '{"motion_template_id":"d4000000-0000-4000-8000-000000000006"}','d5000000-0000-4000-8000-000000000008','d6000000-0000-4000-8000-000000000008',0,3);
 PERFORM tanaghom.claim_creative_motion_job('worker-motion-src-3',120);
 SELECT id INTO jm FROM tanaghom.creative_jobs WHERE claimed_by='worker-motion-src-3' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_motion_input(jm,'worker-motion-src-3');
 RAISE EXCEPTION 'cross-tenant source unexpectedly resolved'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%motion source not found%' THEN RAISE; END IF; END;
END $$;

-- Capability-filtered claim: an older design CPU job is never touched;
-- priority holds among motion jobs; no double-claim.
DO $$ DECLARE old_design uuid; m1 uuid; m2 uuid; got uuid; BEGIN
 old_design := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','design','cpu','{}',
  'd5000000-0000-4000-8000-000000000011','d6000000-0000-4000-8000-000000000011',0,3);
 m1 := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','motion','cpu',
  '{"motion_template_id":"d4000000-0000-4000-8000-000000000002"}','d5000000-0000-4000-8000-000000000012','d6000000-0000-4000-8000-000000000012',0,3);
 m2 := tanaghom.create_creative_job('d1000000-0000-4000-8000-000000000001','motion','cpu',
  '{"motion_template_id":"d4000000-0000-4000-8000-000000000002"}','d5000000-0000-4000-8000-000000000013','d6000000-0000-4000-8000-000000000013',100,3);
 SELECT job_id INTO got FROM tanaghom.claim_creative_motion_job('worker-motion-filter-1',120);
 IF got IS DISTINCT FROM m2 THEN RAISE EXCEPTION 'filtered claim missed priority motion job'; END IF;
 SELECT job_id INTO got FROM tanaghom.claim_creative_motion_job('worker-motion-filter-2',120);
 IF got IS DISTINCT FROM m1 THEN RAISE EXCEPTION 'filtered claim missed second motion job'; END IF;
 SELECT job_id INTO got FROM tanaghom.claim_creative_motion_job('worker-motion-filter-3',120);
 IF got IS NOT NULL THEN RAISE EXCEPTION 'filtered claim touched a foreign job'; END IF;
 PERFORM 1 FROM tanaghom.creative_jobs WHERE id=old_design AND status='queued' AND claimed_by IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'design job was claimed or moved'; END IF;
END $$;

-- Least-privilege boundary: the worker role stays EXECUTE-only.
SET ROLE tanaghom_creative_worker;
DO $$ BEGIN
 BEGIN PERFORM * FROM tanaghom.creative_asset_versions LIMIT 1;
 RAISE EXCEPTION 'worker table select unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN END;
 BEGIN PERFORM * FROM tanaghom.creative_templates LIMIT 1;
 RAISE EXCEPTION 'worker template select unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN END;
END $$;
RESET ROLE;

SELECT 'PASS: creative motion render contract holds.' AS result;
