\set ON_ERROR_STOP on

-- P1a Creative Foundation assertions. Disposable database only.
-- Covers: enqueue/idempotency, claim/lease/heartbeat, retry/cancel/expire,
-- asset versions/lineage/decisions, tenant isolation, worker least privilege,
-- immutable audit. Mirrors controlled_worker_functions.sql idioms.

INSERT INTO tanaghom.organizations (id, slug, name, is_active) VALUES
 ('71000000-0000-4000-8000-000000000001', 'creative-org-a', 'Creative Org A', true),
 ('71000000-0000-4000-8000-000000000002', 'creative-org-b', 'Creative Org B', true);

INSERT INTO tanaghom.app_users (id, organization_id, email, display_name, kind, role, auth_subject, accepted_at) VALUES
 ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'creative-owner-a@example.test', 'Creative Owner A', 'human', 'owner', '73000000-0000-4000-8000-000000000001', now()),
 ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', 'creative-operator-a@example.test', 'Creative Operator A', 'human', 'operator', '73000000-0000-4000-8000-000000000002', now()),
 ('72000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', 'creative-reviewer-a@example.test', 'Creative Reviewer A', 'human', 'reviewer', '73000000-0000-4000-8000-000000000003', now()),
 ('72000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000001', 'creative-viewer-a@example.test', 'Creative Viewer A', 'human', 'viewer', '73000000-0000-4000-8000-000000000004', now()),
 ('72000000-0000-4000-8000-000000001001', '71000000-0000-4000-8000-000000000002', 'creative-owner-b@example.test', 'Creative Owner B', 'human', 'owner', '73000000-0000-4000-8000-000000001001', now());

INSERT INTO tanaghom.brand_kits (id, organization_id, name, current_version) VALUES
 ('77000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Org A Kit', 1);
INSERT INTO tanaghom.brand_kit_versions (id, kit_id, version, colors, arabic_font, created_by) VALUES
 ('77000000-0000-4000-8000-000000000011', '77000000-0000-4000-8000-000000000001', 1, '{"primary":"#0ea5e9"}', 'Cairo', '72000000-0000-4000-8000-000000000001');

-- Control defaults are safe/off.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE NOT enabled AND emergency_stop) THEN
  RAISE EXCEPTION 'creative controls are not safe by default'; END IF;
END $$;

-- Viewer and reviewer cannot enqueue; creation is owner/operator work.
DO $$ BEGIN
 BEGIN PERFORM tanaghom.create_creative_job('72000000-0000-4000-8000-000000000004','image','cpu','{}','75000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001');
 RAISE EXCEPTION 'viewer enqueue unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%owner or operator%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.create_creative_job('72000000-0000-4000-8000-000000000003','image','cpu','{}','75000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000002');
 RAISE EXCEPTION 'reviewer enqueue unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%owner or operator%' THEN RAISE; END IF; END;
END $$;

-- Unknown capability/lane and oversized params are rejected.
DO $$ BEGIN
 BEGIN PERFORM tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','hologram','cpu','{}','75000000-0000-4000-8000-000000000003','76000000-0000-4000-8000-000000000003');
 RAISE EXCEPTION 'bad capability unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%invalid creative job request%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','tpu','{}','75000000-0000-4000-8000-000000000004','76000000-0000-4000-8000-000000000004');
 RAISE EXCEPTION 'bad lane unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%invalid creative job request%' THEN RAISE; END IF; END;
END $$;

-- Happy-path enqueue returns a queued job with lineage fields.
DO $$ DECLARE made uuid; BEGIN
 made := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','cpu','{"prompt":"red square"}','75000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000010',10,3,NULL,NULL,25);
 IF (SELECT status FROM tanaghom.creative_jobs WHERE id=made)<>'queued' THEN RAISE EXCEPTION 'job not queued'; END IF;
 IF (SELECT count(*) FROM tanaghom.creative_job_transitions WHERE job_id=made AND to_status='queued')<>1 THEN RAISE EXCEPTION 'enqueue transition missing'; END IF;
 IF (SELECT count(*) FROM tanaghom.creative_events WHERE job_id=made AND action='job_enqueued')<>1 THEN RAISE EXCEPTION 'enqueue event missing'; END IF;
END $$;

-- Idempotent replay returns the same id; same key with different params conflicts.
DO $$ DECLARE first uuid; second uuid; BEGIN
 first := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','cpu','{"prompt":"replay"}','75000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000011');
 second := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','cpu','{"prompt":"replay"}','75000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000009911');
 IF first IS DISTINCT FROM second THEN RAISE EXCEPTION 'idempotent replay returned a new job'; END IF;
 BEGIN PERFORM tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','cpu','{"prompt":"different"}','75000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000009912');
 RAISE EXCEPTION 'conflicting reuse unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%idempotency conflict%' THEN RAISE; END IF; END;
END $$;

-- Claim is gated on the control switch.
DO $$ BEGIN
 BEGIN PERFORM tanaghom.claim_creative_job('cpu','worker-1',120);
 RAISE EXCEPTION 'claim while stopped unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%creative runtime stopped%' THEN RAISE; END IF; END;
END $$;
UPDATE tanaghom.creative_controls SET enabled=true, emergency_stop=false, reason='Disposable creative foundation test';

-- Claim takes exactly one job; a second claim finds nothing (SKIP LOCKED).
DO $$ DECLARE got uuid; none uuid; BEGIN
 SELECT job_id INTO got FROM tanaghom.claim_creative_job('cpu','worker-1',120) LIMIT 1;
 IF got IS NULL THEN RAISE EXCEPTION 'claim returned nothing'; END IF;
 IF (SELECT status FROM tanaghom.creative_jobs WHERE id=got)<>'claimed' THEN RAISE EXCEPTION 'job not claimed'; END IF;
 IF (SELECT attempt FROM tanaghom.creative_jobs WHERE id=got)<>1 THEN RAISE EXCEPTION 'claim did not count the attempt'; END IF;
 SELECT job_id INTO none FROM tanaghom.claim_creative_job('cpu','worker-1',120) LIMIT 1;
 -- Another queued job may exist from earlier fixtures; claiming must never return the same row twice.
 IF none IS NOT DISTINCT FROM got THEN RAISE EXCEPTION 'double claim returned the same job'; END IF;
END $$;

-- Heartbeat extends the lease; a foreign worker is rejected.
DO $$ DECLARE j uuid; lease timestamptz; BEGIN
 PERFORM tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','cpu','{"t":"hb"}','75000000-0000-4000-8000-000000000015','76000000-0000-4000-8000-000000000015');
 PERFORM tanaghom.claim_creative_job('cpu','worker-hb',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-hb' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 lease := tanaghom.heartbeat_creative_job(j,'worker-hb',300);
 IF lease IS NULL OR lease<=now() THEN RAISE EXCEPTION 'heartbeat did not extend the lease'; END IF;
 BEGIN PERFORM tanaghom.heartbeat_creative_job(j,'intruder',300);
 RAISE EXCEPTION 'foreign heartbeat unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%worker mismatch%' THEN RAISE; END IF; END;
END $$;

-- Running marker is cooperative with cancellation.
DO $$ DECLARE j uuid; s text; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','design','cpu','{}','75000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000020');
 PERFORM tanaghom.claim_creative_job('cpu','worker-run',120);
 -- claim may have taken an older queued fixture; resolve the newest claimed row for this worker instead.
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-run' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 s := tanaghom.mark_creative_job_running(j,'worker-run');
 IF s<>'running' THEN RAISE EXCEPTION 'job did not start running'; END IF;
 PERFORM tanaghom.request_creative_cancel('72000000-0000-4000-8000-000000000001',j);
 s := tanaghom.fail_creative_job(j,'worker-run','cancelled','operator cancelled',0);
 IF s<>'cancelled' THEN RAISE EXCEPTION 'cancelled class did not cancel'; END IF;
END $$;

-- Cancel while claimed flags cooperatively; the running marker then cancels.
DO $$ DECLARE j uuid; s text; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','design','cpu','{}','75000000-0000-4000-8000-000000000021','76000000-0000-4000-8000-000000000021');
 PERFORM tanaghom.claim_creative_job('cpu','worker-coop',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-coop' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 IF tanaghom.request_creative_cancel('72000000-0000-4000-8000-000000000002',j)<>'cancel_requested' THEN RAISE EXCEPTION 'coop cancel misreported'; END IF;
 s := tanaghom.mark_creative_job_running(j,'worker-coop');
 IF s<>'cancelled' THEN RAISE EXCEPTION 'cooperative cancel did not win'; END IF;
END $$;

-- Cancel before claim cancels immediately; terminal rows refuse cancel.
DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','carousel','cpu','{}','75000000-0000-4000-8000-000000000022','76000000-0000-4000-8000-000000000022');
 IF tanaghom.request_creative_cancel('72000000-0000-4000-8000-000000000001',j)<>'cancelled' THEN RAISE EXCEPTION 'queued cancel misreported'; END IF;
 BEGIN PERFORM tanaghom.request_creative_cancel('72000000-0000-4000-8000-000000000001',j);
 RAISE EXCEPTION 'terminal cancel unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%already terminal%' THEN RAISE; END IF; END;
END $$;

-- Transient failure requeues within budget; exhaustion fails terminally.
DO $$ DECLARE j uuid; s text; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','gpu_image','{}','75000000-0000-4000-8000-000000000023','76000000-0000-4000-8000-000000000023',0,3);
 PERFORM tanaghom.claim_creative_job('gpu_image','worker-retry',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-retry' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 s := tanaghom.fail_creative_job(j,'worker-retry','transient','flaky provider',0);
 IF s<>'queued' THEN RAISE EXCEPTION 'transient failure did not requeue'; END IF;
 IF (SELECT status FROM tanaghom.creative_jobs WHERE id=j)<>'queued' THEN RAISE EXCEPTION 'requeue state wrong'; END IF;
END $$;
DO $$ DECLARE j uuid; s text; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','gpu_image','{}','75000000-0000-4000-8000-000000000024','76000000-0000-4000-8000-000000000024',100,1);
 PERFORM tanaghom.claim_creative_job('gpu_image','worker-once',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-once' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 s := tanaghom.fail_creative_job(j,'worker-once','transient','flaky provider',0);
 IF s<>'failed' THEN RAISE EXCEPTION 'exhausted budget did not fail'; END IF;
END $$;
DO $$ DECLARE j uuid; s text; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','gpu_image','{}','75000000-0000-4000-8000-000000000025','76000000-0000-4000-8000-000000000025',100,3);
 PERFORM tanaghom.claim_creative_job('gpu_image','worker-det',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-det' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 s := tanaghom.fail_creative_job(j,'worker-det','deterministic','bad params',0);
 IF s<>'failed' THEN RAISE EXCEPTION 'deterministic failure retried'; END IF;
END $$;

-- Lapsed leases expire through the reaper, never silently.
DO $$ DECLARE j uuid; n integer; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','motion','cpu','{}','75000000-0000-4000-8000-000000000026','76000000-0000-4000-8000-000000000026');
 PERFORM tanaghom.claim_creative_job('cpu','worker-lapse',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-lapse' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 UPDATE tanaghom.creative_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=j;
 BEGIN PERFORM tanaghom.heartbeat_creative_job(j,'worker-lapse',120);
 RAISE EXCEPTION 'lapsed heartbeat unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%lease expired%' THEN RAISE; END IF; END;
 n := tanaghom.expire_creative_leases();
 IF n<1 THEN RAISE EXCEPTION 'reaper expired nothing'; END IF;
 IF (SELECT status FROM tanaghom.creative_jobs WHERE id=j)<>'expired' THEN RAISE EXCEPTION 'job did not expire'; END IF;
END $$;

-- Full mock lifecycle: claim, run, register v1, complete, approve.
DO $$ DECLARE j uuid; v uuid; a uuid; s text; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000002','image','cpu','{"prompt":"mock square"}','75000000-0000-4000-8000-000000000030','76000000-0000-4000-8000-000000000030');
 PERFORM tanaghom.claim_creative_job('cpu','worker-mock',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-mock' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 PERFORM tanaghom.mark_creative_job_running(j,'worker-mock');
 v := tanaghom.create_creative_asset_version(j,'worker-mock',NULL,'Mock square','image/png',1024,1024,NULL,12345,
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  't/71000000-0000-4000-8000-000000000001/image/'||j::text||'/v1.png',
  't/71000000-0000-4000-8000-000000000001/image/'||j::text||'/v1.thumb.png',
  '{"adapter":"mock","seed":7}','mock/v1','mock-ad','mock');
 IF (SELECT version FROM tanaghom.creative_asset_versions WHERE id=v)<>1 THEN RAISE EXCEPTION 'first version is not v1'; END IF;
 SELECT asset_id INTO a FROM tanaghom.creative_asset_versions WHERE id=v;
 s := tanaghom.complete_creative_job(j,'worker-mock',v,4);
 IF s<>'succeeded' THEN RAISE EXCEPTION 'job did not succeed'; END IF;
 IF NOT (SELECT output_asset_ids FROM tanaghom.creative_jobs WHERE id=j) @> ARRAY[a] THEN RAISE EXCEPTION 'asset linkage missing'; END IF;
 IF tanaghom.decide_creative_asset_version('72000000-0000-4000-8000-000000000003',v,'approved',NULL)<>'approved' THEN RAISE EXCEPTION 'reviewer approval failed'; END IF;
 IF (SELECT status FROM tanaghom.creative_asset_versions WHERE id=v)<>'approved' THEN RAISE EXCEPTION 'version not approved'; END IF;
 BEGIN PERFORM tanaghom.decide_creative_asset_version('72000000-0000-4000-8000-000000000001',v,'rejected','too late');
 RAISE EXCEPTION 'second decision unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%not reviewable%' THEN RAISE; END IF; END;
END $$;

-- Edit lineage: v2 links v1 as parent; history rows never change.
DO $$ DECLARE j uuid; v1 uuid; v2 uuid; a uuid; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000002','edit','cpu','{"op":"warm"}','75000000-0000-4000-8000-000000000031','76000000-0000-4000-8000-000000000031');
 PERFORM tanaghom.claim_creative_job('cpu','worker-edit',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-edit' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 PERFORM tanaghom.mark_creative_job_running(j,'worker-edit');
 v1 := tanaghom.create_creative_asset_version(j,'worker-edit',NULL,'Lineage base','image/png',512,512,NULL,1111,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','t/71000000-0000-4000-8000-000000000001/edit/'||j::text||'/v1.png',NULL,'{"adapter":"mock"}',NULL,NULL,'mock');
 SELECT asset_id INTO a FROM tanaghom.creative_asset_versions WHERE id=v1;
 v2 := tanaghom.create_creative_asset_version(j,'worker-edit',a,'Lineage warm','image/png',512,512,NULL,2222,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','t/71000000-0000-4000-8000-000000000001/edit/'||j::text||'/v2.png',NULL,'{"adapter":"mock"}',NULL,NULL,'edit');
 IF (SELECT parent_version_id FROM tanaghom.creative_asset_versions WHERE id=v2) IS DISTINCT FROM v1 THEN RAISE EXCEPTION 'v2 parent linkage broken'; END IF;
 PERFORM tanaghom.complete_creative_job(j,'worker-edit',v2,NULL);
 BEGIN UPDATE tanaghom.creative_asset_versions SET title='rewritten' WHERE id=v1;
 RAISE EXCEPTION 'history rewrite unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%immutable except review state%' THEN RAISE; END IF; END;
 BEGIN DELETE FROM tanaghom.creative_asset_versions WHERE id=v1;
 RAISE EXCEPTION 'history delete unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%immutable except review state%' THEN RAISE; END IF; END;
END $$;

-- Rejection requires feedback; viewers cannot decide; cross-tenant decide is denied.
DO $$ DECLARE j uuid; v uuid; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000002','design','cpu','{}','75000000-0000-4000-8000-000000000032','76000000-0000-4000-8000-000000000032');
 PERFORM tanaghom.claim_creative_job('cpu','worker-decide',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-decide' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 PERFORM tanaghom.mark_creative_job_running(j,'worker-decide');
 v := tanaghom.create_creative_asset_version(j,'worker-decide',NULL,'Decide me','image/png',256,256,NULL,999,
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','t/71000000-0000-4000-8000-000000000001/design/'||j::text||'/v1.png',NULL,'{}',NULL,NULL,'mock');
 PERFORM tanaghom.complete_creative_job(j,'worker-decide',v,NULL);
 BEGIN PERFORM tanaghom.decide_creative_asset_version('72000000-0000-4000-8000-000000000001',v,'rejected',NULL);
 RAISE EXCEPTION 'feedbackless rejection unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%requires feedback%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.decide_creative_asset_version('72000000-0000-4000-8000-000000000004',v,'approved',NULL);
 RAISE EXCEPTION 'viewer decision unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%owner or reviewer%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.decide_creative_asset_version('72000000-0000-4000-8000-000000001001',v,'approved',NULL);
 RAISE EXCEPTION 'cross-tenant decision unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%owner or reviewer%' THEN RAISE; END IF; END;
 IF tanaghom.decide_creative_asset_version('72000000-0000-4000-8000-000000000001',v,'rejected','off-brand')<>'rejected' THEN RAISE EXCEPTION 'owner rejection failed'; END IF;
END $$;

-- Cross-tenant cancel is denied.
DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','cpu','{}','75000000-0000-4000-8000-000000000033','76000000-0000-4000-8000-000000000033');
 BEGIN PERFORM tanaghom.request_creative_cancel('72000000-0000-4000-8000-000000001001',j);
 RAISE EXCEPTION 'cross-tenant cancel unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%owner or operator%' THEN RAISE; END IF; END;
 PERFORM tanaghom.request_creative_cancel('72000000-0000-4000-8000-000000000002',j);
END $$;

-- Worker least privilege: no direct writes; only granted functions execute.
SET ROLE tanaghom_creative_worker;
DO $$ BEGIN
 BEGIN INSERT INTO tanaghom.creative_jobs(id) VALUES(gen_random_uuid());
 RAISE EXCEPTION 'worker insert unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE<>'42501' THEN RAISE; END IF; END;
 BEGIN UPDATE tanaghom.creative_jobs SET priority=99 WHERE id='74000000-0000-4000-8000-000000000001';
 RAISE EXCEPTION 'worker update unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE<>'42501' THEN RAISE; END IF; END;
 BEGIN DELETE FROM tanaghom.creative_events WHERE id=1;
 RAISE EXCEPTION 'worker delete unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE<>'42501' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','image','cpu','{}','75000000-0000-4000-8000-000000000040','76000000-0000-4000-8000-000000000040');
 RAISE EXCEPTION 'worker enqueue unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE<>'42501' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.decide_creative_asset_version('72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','approved',NULL);
 RAISE EXCEPTION 'worker decide unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE<>'42501' THEN RAISE; END IF; END;
 PERFORM tanaghom.expire_creative_leases();
END $$;
RESET ROLE;

-- Claiming as the worker role works end to end through grants only.
SET ROLE tanaghom_creative_worker;
SELECT count(*) FROM tanaghom.claim_creative_job('cpu','worker-grant-check',120);
RESET ROLE;

-- Audit tables reject mutation.
DO $$ BEGIN
 BEGIN UPDATE tanaghom.creative_job_transitions SET reason='rewritten' WHERE id=1;
 RAISE EXCEPTION 'transition rewrite unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END;
 BEGIN DELETE FROM tanaghom.creative_events WHERE id=1;
 RAISE EXCEPTION 'event delete unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END;
 BEGIN UPDATE tanaghom.brand_kit_versions SET tone='rewritten' WHERE id='77000000-0000-4000-8000-000000000011';
 RAISE EXCEPTION 'brand version rewrite unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF; END;
END $$;

-- Template names are tenant-scoped: both orgs may own ('ad','promo',1).
INSERT INTO tanaghom.creative_templates(organization_id,kind,name,spec,version) VALUES
 ('71000000-0000-4000-8000-000000000001','ad','promo','{}',1),
 ('71000000-0000-4000-8000-000000000002','ad','promo','{}',1),
 (NULL,'ad','promo','{}',1);
DO $$ BEGIN
 BEGIN INSERT INTO tanaghom.creative_templates(organization_id,kind,name,spec,version)
  VALUES('71000000-0000-4000-8000-000000000001','ad','promo','{}',1);
 RAISE EXCEPTION 'same-org duplicate template unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE<>'23505' THEN RAISE; END IF; END;
 BEGIN INSERT INTO tanaghom.creative_templates(organization_id,kind,name,spec,version)
  VALUES(NULL,'ad','promo','{}',1);
 RAISE EXCEPTION 'duplicate global template unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE<>'23505' THEN RAISE; END IF; END;
END $$;

-- Brand-kit linkage is referentially enforced, not just checked at enqueue.
DO $$ DECLARE j uuid; BEGIN
 BEGIN PERFORM tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','design','cpu','{}','75000000-0000-4000-8000-000000000050','76000000-0000-4000-8000-000000000050',0,3,NULL,'77000000-0000-4000-8000-000000000099',NULL);
 RAISE EXCEPTION 'unknown brand kit unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%unknown brand kit version%' THEN RAISE; END IF; END;
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000001','design','cpu','{}','75000000-0000-4000-8000-000000000051','76000000-0000-4000-8000-000000000051',0,3,NULL,'77000000-0000-4000-8000-000000000011',NULL);
 IF (SELECT brand_kit_version_id FROM tanaghom.creative_jobs WHERE id=j) IS DISTINCT FROM '77000000-0000-4000-8000-000000000011' THEN RAISE EXCEPTION 'brand kit version not stored'; END IF;
 BEGIN PERFORM tanaghom.create_creative_job('72000000-0000-4000-8000-000000001001','design','cpu','{}','75000000-0000-4000-8000-000000000052','76000000-0000-4000-8000-000000000052',0,3,NULL,'77000000-0000-4000-8000-000000000011',NULL);
 RAISE EXCEPTION 'cross-org brand kit unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%unknown brand kit version%' THEN RAISE; END IF; END;
 BEGIN INSERT INTO tanaghom.creative_jobs(organization_id,requested_by,idempotency_key,input_hash,correlation_id,capability,lane,params,brand_kit_version_id)
  VALUES('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000053','h','76000000-0000-4000-8000-000000000053','image','cpu','{}','77000000-0000-4000-8000-000000000099');
 RAISE EXCEPTION 'orphan brand kit insert unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE<>'23503' THEN RAISE; END IF; END;
END $$;

-- Worker lifecycle mirrors into canonical agent_actions_log with job correlation.
DO $$ DECLARE j uuid; c uuid; v uuid; n_events integer; n_log integer; n_actions integer; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000002','image','cpu','{"m":"audit"}','75000000-0000-4000-8000-000000000060','76000000-0000-4000-8000-000000000060',100,3);
 SELECT correlation_id INTO c FROM tanaghom.creative_jobs WHERE id=j;
 PERFORM tanaghom.claim_creative_job('cpu','worker-audit',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-audit' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 PERFORM tanaghom.mark_creative_job_running(j,'worker-audit');
 PERFORM tanaghom.heartbeat_creative_job(j,'worker-audit',120);
 PERFORM tanaghom.fail_creative_job(j,'worker-audit','transient','audit probe',0);
 PERFORM tanaghom.claim_creative_job('cpu','worker-audit',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-audit' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 PERFORM tanaghom.mark_creative_job_running(j,'worker-audit');
 v := tanaghom.create_creative_asset_version(j,'worker-audit',NULL,'Audit artifact','image/png',64,64,NULL,512,
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','t/71000000-0000-4000-8000-000000000001/image/'||j::text||'/v1.png',NULL,'{"adapter":"mock"}',NULL,NULL,'mock');
 PERFORM tanaghom.complete_creative_job(j,'worker-audit',v,NULL);
 SELECT count(*) INTO n_events FROM tanaghom.creative_events WHERE job_id=j;
 SELECT count(*) INTO n_log FROM tanaghom.agent_actions_log WHERE correlation_id=c;
 SELECT count(DISTINCT action_type) INTO n_actions FROM tanaghom.agent_actions_log WHERE correlation_id=c;
 IF n_events<>9 THEN RAISE EXCEPTION 'expected 9 creative events, saw %',n_events; END IF;
 IF n_log<>8 THEN RAISE EXCEPTION 'expected 8 canonical audit rows, saw %',n_log; END IF;
 IF n_actions<>6 THEN RAISE EXCEPTION 'expected 6 distinct audit actions, saw %',n_actions; END IF;
 IF EXISTS(SELECT 1 FROM tanaghom.agent_actions_log WHERE correlation_id=c AND action_type NOT LIKE 'creative.%') THEN RAISE EXCEPTION 'non-creative audit leaked into job trace'; END IF;
END $$;

-- Object keys require the strict tenant-prefixed shape, not substring presence.
DO $$ DECLARE j uuid; BEGIN
 j := tanaghom.create_creative_job('72000000-0000-4000-8000-000000000002','image','cpu','{"m":"key"}','75000000-0000-4000-8000-000000000061','76000000-0000-4000-8000-000000000061');
 PERFORM tanaghom.claim_creative_job('cpu','worker-key',120);
 SELECT id INTO j FROM tanaghom.creative_jobs WHERE claimed_by='worker-key' AND status='claimed' ORDER BY created_at DESC LIMIT 1;
 PERFORM tanaghom.mark_creative_job_running(j,'worker-key');
 BEGIN PERFORM tanaghom.create_creative_asset_version(j,'worker-key',NULL,'Sneaky','image/png',64,64,NULL,512,
   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','t/71000000-0000-4000-8000-000000000002/image/71000000-0000-4000-8000-000000000001/v1.png',NULL,'{}',NULL,NULL,'mock');
 RAISE EXCEPTION 'mid-string tenant scope unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%tenant scope%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.create_creative_asset_version(j,'worker-key',NULL,'Loud','image/png',64,64,NULL,512,
   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','T/71000000-0000-4000-8000-000000000001/IMAGE/'||j::text||'/V1.PNG',NULL,'{}',NULL,NULL,'mock');
 RAISE EXCEPTION 'uppercase key unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%tenant scope%' THEN RAISE; END IF; END;
 BEGIN PERFORM tanaghom.create_creative_asset_version(j,'worker-key',NULL,'Wrong ext','image/png',64,64,NULL,512,
   'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','t/71000000-0000-4000-8000-000000000001/image/'||j::text||'/v1.pdf',NULL,'{}',NULL,NULL,'mock');
 RAISE EXCEPTION 'disallowed extension unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%tenant scope%' THEN RAISE; END IF; END;
 IF NOT tanaghom.creative_object_key_is_scoped('t/71000000-0000-4000-8000-000000000001/image/'||j::text||'/v1.png','71000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'valid key rejected'; END IF;
END $$;

-- Control switch is owner-only.
DO $$ BEGIN
 BEGIN PERFORM tanaghom.set_creative_control('72000000-0000-4000-8000-000000000004',true,false,'viewer attempt');
 RAISE EXCEPTION 'viewer control change unexpectedly succeeded'; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%requires owner%' THEN RAISE; END IF; END;
 PERFORM tanaghom.set_creative_control('72000000-0000-4000-8000-000000000001',true,false,'Disposable creative foundation test');
 IF NOT EXISTS(SELECT 1 FROM tanaghom.creative_controls WHERE enabled AND NOT emergency_stop) THEN RAISE EXCEPTION 'control did not open'; END IF;
 PERFORM tanaghom.set_creative_control('72000000-0000-4000-8000-000000000001',false,true,'Disposable creative foundation test complete');
END $$;

SELECT 'PASS: creative foundation contract holds.' AS result;
