\set ON_ERROR_STOP on

-- P1b Creative Studio assertions. Disposable database only. Runs after
-- creative_foundation.sql on the same database; fixture ids are disjoint.
-- Covers: brand-kit lifecycle, template lifecycle, upload registration,
-- object-key uniqueness, control-gated upload pipeline.

INSERT INTO tanaghom.organizations (id, slug, name, is_active) VALUES
 ('81000000-0000-4000-8000-000000000001', 'studio-org-a', 'Studio Org A', true),
 ('81000000-0000-4000-8000-000000000002', 'studio-org-b', 'Studio Org B', true);

INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
 ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'studio-owner-a@example.test', 'Studio Owner A', 'human', 'owner', '83000000-0000-4000-8000-000000000001', now()),
 ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 'studio-operator-a@example.test', 'Studio Operator A', 'human', 'operator', '83000000-0000-4000-8000-000000000002', now()),
 ('82000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', 'studio-reviewer-a@example.test', 'Studio Reviewer A', 'human', 'reviewer', '83000000-0000-4000-8000-000000000003', now()),
 ('82000000-0000-4000-8000-000000001001', '81000000-0000-4000-8000-000000000002', 'studio-owner-b@example.test', 'Studio Owner B', 'human', 'owner', '83000000-0000-4000-8000-000000001001', now());

UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable creative studio test';

-- Brand Kit creation is owner-only with validated fields.
DO $$ DECLARE kit uuid; BEGIN
 kit := tanaghom.create_brand_kit('82000000-0000-4000-8000-000000000001','Studio Kit','{"primary":"#0ea5e9"}','{"body":"Cairo"}','Cairo','Inter','{}','Calm','{}','{}','{}');
 IF (SELECT current_version FROM tanaghom.brand_kits WHERE id=kit)<>1 THEN RAISE EXCEPTION 'kit did not start at v1'; END IF;
 IF (SELECT count(*) FROM tanaghom.brand_kit_versions WHERE kit_id=kit)<>1 THEN RAISE EXCEPTION 'kit v1 missing'; END IF;
 BEGIN PERFORM tanaghom.create_brand_kit('82000000-0000-4000-8000-000000000003','Reviewer Kit');
 RAISE EXCEPTION 'reviewer kit unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%brand kit requires owner%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.create_brand_kit('82000000-0000-4000-8000-000000000002','Operator Kit');
 RAISE EXCEPTION 'operator kit unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%brand kit requires owner%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.create_brand_kit('82000000-0000-4000-8000-000000000001','  ');
 RAISE EXCEPTION 'blank kit name unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%invalid brand kit name%' THEN RAISE; END IF; END;
END $$;

-- Versions accumulate immutably; the current pointer moves only via setter.
DO $$ DECLARE kit uuid; v1 uuid; v2 uuid; BEGIN
 SELECT id INTO kit FROM tanaghom.brand_kits WHERE organization_id='81000000-0000-4000-8000-000000000001' AND name='Studio Kit';
 SELECT id INTO v1 FROM tanaghom.brand_kit_versions WHERE kit_id=kit AND version=1;
 v2 := tanaghom.create_brand_kit_version('82000000-0000-4000-8000-000000000001',kit,'{"primary":"#111111"}');
 IF (SELECT version FROM tanaghom.brand_kit_versions WHERE id=v2)<>2 THEN RAISE EXCEPTION 'second version is not v2'; END IF;
 IF (SELECT current_version FROM tanaghom.brand_kits WHERE id=kit)<>1 THEN RAISE EXCEPTION 'current moved without setter'; END IF;
 IF (SELECT colors FROM tanaghom.brand_kit_versions WHERE id=v1)!= '{"primary":"#0ea5e9"}'::jsonb THEN RAISE EXCEPTION 'v1 mutated'; END IF;
 IF tanaghom.set_brand_kit_current('82000000-0000-4000-8000-000000000001',kit,2)<>2 THEN RAISE EXCEPTION 'set current misreported'; END IF;
 IF (SELECT current_version FROM tanaghom.brand_kits WHERE id=kit)<>2 THEN RAISE EXCEPTION 'current did not move'; END IF;
 BEGIN PERFORM tanaghom.set_brand_kit_current('82000000-0000-4000-8000-000000000001',kit,9);
 RAISE EXCEPTION 'unknown version pointer unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%unknown brand kit version%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.create_brand_kit_version('82000000-0000-4000-8000-000000000003',kit,'{}');
 RAISE EXCEPTION 'reviewer version unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%brand kit requires owner%' THEN RAISE; END IF; END;
END $$;

-- Templates version per scope; globals are separate from org rows.
DO $$ DECLARE t1 uuid; t2 uuid; g1 uuid; BEGIN
 t1 := tanaghom.create_creative_template('82000000-0000-4000-8000-000000000001',false,'ad','launch','{"headline":"Go"}');
 t2 := tanaghom.create_creative_template('82000000-0000-4000-8000-000000000001',false,'ad','launch','{"headline":"Go again"}');
 IF (SELECT version FROM tanaghom.creative_templates WHERE id=t2)<>2 THEN RAISE EXCEPTION 'template did not version to v2'; END IF;
 g1 := tanaghom.create_creative_template('82000000-0000-4000-8000-000000001001',true,'ad','launch','{"headline":"Global"}');
 IF (SELECT version FROM tanaghom.creative_templates WHERE id=g1)<>1 THEN RAISE EXCEPTION 'global scope shares org numbering'; END IF;
 BEGIN PERFORM tanaghom.create_creative_template('82000000-0000-4000-8000-000000000003',false,'ad','launch','{"headline":"Nope"}');
 RAISE EXCEPTION 'reviewer template unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%template requires owner%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.create_creative_template('82000000-0000-4000-8000-000000000001',false,'ad','launch','[1,2]');
 RAISE EXCEPTION 'non-object spec unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%invalid creative template%' THEN RAISE; END IF; END;
 IF tanaghom.set_creative_template_active('82000000-0000-4000-8000-000000000001',t1,false)<>false THEN RAISE EXCEPTION 'deactivate misreported'; END IF;
 IF (SELECT is_active FROM tanaghom.creative_templates WHERE id=t1) THEN RAISE EXCEPTION 'template still active'; END IF;
 BEGIN PERFORM tanaghom.set_creative_template_active('82000000-0000-4000-8000-000000001001',t2,false);
 RAISE EXCEPTION 'cross-tenant template toggle unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%cross-tenant template forbidden%' THEN RAISE; END IF; END;
END $$;

-- Upload registration runs the full job lifecycle in one transaction.
DO $$ DECLARE rec record; BEGIN
 SELECT * INTO rec FROM tanaghom.register_upload_asset('82000000-0000-4000-8000-000000000002','image','Studio upload','image/png',32,32,1024,
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','t/81000000-0000-4000-8000-000000000001/image/88000000-0000-4000-8000-000000000001/v1.png',
  '{"upload":true,"original_name":"photo.png"}','85000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000001');
 IF (SELECT status FROM tanaghom.creative_jobs WHERE id=rec.o_job_id)<>'succeeded' THEN RAISE EXCEPTION 'upload job did not succeed'; END IF;
 IF (SELECT method FROM tanaghom.creative_asset_versions WHERE id=rec.o_version_id)<>'upload' THEN RAISE EXCEPTION 'upload method not recorded'; END IF;
 IF (SELECT count(*) FROM tanaghom.agent_actions_log WHERE correlation_id='86000000-0000-4000-8000-000000000001')<4 THEN RAISE EXCEPTION 'upload audit lineage short'; END IF;
 BEGIN PERFORM tanaghom.register_upload_asset('82000000-0000-4000-8000-000000000003','image','Reviewer upload','image/png',32,32,1024,
   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','t/81000000-0000-4000-8000-000000000001/image/88000000-0000-4000-8000-000000000002/v1.png',
   '{}','85000000-0000-4000-8000-000000000002','86000000-0000-4000-8000-000000000002');
 RAISE EXCEPTION 'reviewer upload unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%owner or operator%' THEN RAISE; END IF; END;
END $$;

-- Duplicate object keys are rejected at the database boundary.
DO $$ BEGIN
 BEGIN INSERT INTO tanaghom.creative_asset_versions(asset_id,version,job_id,title,mime,bytes,sha256,object_key,method)
  SELECT asset_id,99,job_id,'Dupe','image/png',1,'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',object_key,'mock'
  FROM tanaghom.creative_asset_versions LIMIT 1;
 RAISE EXCEPTION 'duplicate object key unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE<>'23505' THEN RAISE; END IF; END;
END $$;

SELECT 'PASS: creative studio contract holds.' AS result;
