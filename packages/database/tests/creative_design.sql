\set ON_ERROR_STOP on

-- P2b render-input assertions. Disposable database only. Runs after the
-- image-lane fixtures on the same database; ids use the b0/b1/b2 range.

INSERT INTO tanaghom.organizations (id, slug, name, is_active) VALUES
 ('b0000000-0000-4000-8000-000000000001', 'design-org-a', 'Design Org A', true),
 ('b0000000-0000-4000-8000-000000000002', 'design-org-b', 'Design Org B', true);

INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
 ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'design-owner-a@example.test', 'Design Owner A', 'human', 'owner', 'b2000000-0000-4000-8000-000000000001', now()),
 ('b1000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000002', 'design-owner-b@example.test', 'Design Owner B', 'human', 'owner', 'b2000000-0000-4000-8000-000000001011', now());

INSERT INTO tanaghom.brand_kits (id, organization_id, name, current_version) VALUES
 ('b3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Design Kit', 1);
INSERT INTO tanaghom.brand_kit_versions (id, kit_id, version, colors, created_by) VALUES
 ('b3000000-0000-4000-8000-000000000011', 'b3000000-0000-4000-8000-000000000001', 1, '{"primary":"#0ea5e9"}', 'b1000000-0000-4000-8000-000000000001');

INSERT INTO tanaghom.creative_templates(id,organization_id,kind,name,spec,version,is_active) VALUES
 ('b4000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','ad','design-doc','{"locale":"ar","direction":"rtl","canvas":{"width":1080,"height":1080},"nodes":[{"id":"h1","type":"text","x":90,"y":120,"width":900,"height":220,"text":"T"}]}',1,true),
 ('b4000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','ad','foreign-doc','{"locale":"en","direction":"ltr","canvas":{"width":1080,"height":1080},"nodes":[{"id":"h1","type":"text","x":90,"y":120,"width":900,"height":220,"text":"T"}]}',1,true);

UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable design render test';

-- Happy path: worker-claimed design job resolves template, brand, params.
DO $$ DECLARE j uuid; input jsonb; BEGIN
 j := tanaghom.create_creative_job('b1000000-0000-4000-8000-000000000001','design','cpu',
  '{"design_template_id":"b4000000-0000-4000-8000-000000000001","design_version":1,"format":"1:1","brand_kit_version_id":"b3000000-0000-4000-8000-000000000011"}',
  'b5000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',100,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-design',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-design' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 SELECT tanaghom.get_creative_render_input(j,'worker-design') INTO input;
 IF input->>'capability' IS DISTINCT FROM 'design' THEN RAISE EXCEPTION 'wrong capability'; END IF;
 IF input->'template'->>'id' IS DISTINCT FROM 'b4000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'wrong template'; END IF;
 IF input->'brand_kit_version'->>'id' IS DISTINCT FROM 'b3000000-0000-4000-8000-000000000011' THEN RAISE EXCEPTION 'brand snapshot missing'; END IF;
 IF input->'params'->>'format' IS DISTINCT FROM '1:1' THEN RAISE EXCEPTION 'params missing'; END IF;
END $$;

-- Foreign worker, unknown job, non-design capability, cross-tenant doc, bad brand, version skew.
DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('b1000000-0000-4000-8000-000000000001','design','cpu',
  '{"design_template_id":"b4000000-0000-4000-8000-000000000001"}','b5000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000002',100,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-design-2',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-design-2' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_render_input(j,'intruder');
 RAISE EXCEPTION 'foreign render read unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%worker mismatch%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.get_creative_render_input('b5000000-0000-4000-8000-000000000099','worker-design-2');
 RAISE EXCEPTION 'unknown job render unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%unknown creative job%' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('b1000000-0000-4000-8000-000000000001','image','cpu','{}','b5000000-0000-4000-8000-000000000003','b6000000-0000-4000-8000-000000000003',100,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-design-3',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-design-3' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_render_input(j,'worker-design-3');
 RAISE EXCEPTION 'non-design render unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%not a design render job%' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('b1000000-0000-4000-8000-000000000001','design','cpu',
  '{"design_template_id":"b4000000-0000-4000-8000-000000000002"}','b5000000-0000-4000-8000-000000000004','b6000000-0000-4000-8000-000000000004',100,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-design-4',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-design-4' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_render_input(j,'worker-design-4');
 RAISE EXCEPTION 'cross-tenant render unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%unknown design template%' THEN RAISE; END IF; END;
END $$;

DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('b1000000-0000-4000-8000-000000000001','design','cpu',
  '{"design_template_id":"b4000000-0000-4000-8000-000000000001","design_version":7}','b5000000-0000-4000-8000-000000000005','b6000000-0000-4000-8000-000000000005',100,3);
 PERFORM tanaghom.claim_creative_job('cpu','worker-design-5',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-design-5' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 BEGIN PERFORM tanaghom.get_creative_render_input(j,'worker-design-5');
 RAISE EXCEPTION 'version skew unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%design version mismatch%' THEN RAISE; END IF; END;
END $$;

SELECT 'PASS: creative design render contract holds.' AS result;
