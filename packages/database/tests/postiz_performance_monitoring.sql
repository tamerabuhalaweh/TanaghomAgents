\set ON_ERROR_STOP on

DO $$
BEGIN
  IF has_table_privilege('tanaghom_n8n_worker', 'tanaghom.post_metric_observations', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_n8n_worker', 'tanaghom.post_performance_sync_state', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('tanaghom_n8n_worker', 'tanaghom.lead_attribution_records', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'n8n received direct Phase 4H table writes';
  END IF;
  IF NOT has_function_privilege('tanaghom_api', 'tanaghom.queue_postiz_performance_sync(uuid,uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('tanaghom_n8n_worker', 'tanaghom.claim_postiz_performance_job()', 'EXECUTE')
     OR NOT has_function_privilege('tanaghom_n8n_worker', 'tanaghom.prepare_postiz_performance_sync(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('tanaghom_n8n_worker', 'tanaghom.complete_postiz_performance_sync(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'controlled Phase 4H grants are missing';
  END IF;
END;
$$;

UPDATE tanaghom.integration_connections
SET status = 'connected', credential_ciphertext = decode('01', 'hex'),
    credential_nonce = decode(repeat('02', 12), 'hex'),
    credential_auth_tag = decode(repeat('03', 16), 'hex'),
    credential_key_version = 1, secret_last_four = 'test', disconnected_at = NULL
WHERE provider = 'postiz';
UPDATE tanaghom.organization_automation_policies
SET postiz_draft_mode = 'manual'
WHERE organization_id = '10000000-0000-4000-8000-000000000001';
UPDATE tanaghom.automation_platform_controls
SET emergency_stop = false, reason = 'Disposable performance monitor test'
WHERE provider = 'postiz';

INSERT INTO tanaghom.campaign_strategies (
  id, campaign_id, version, positioning, key_messages, channels,
  posting_cadence, content_pillars, model_name, prompt_version
) VALUES (
  '71000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 510, 'Performance fixture',
  '["safe"]', '["instagram"]', '{"instagram":{"posts_per_week":1}}', '["proof"]', 'none', 'phase4h-test'
);
INSERT INTO tanaghom.content_items (
  id, campaign_id, strategy_id, generation, channel, content_type,
  draft_copy, media_brief, status
) VALUES (
  '71000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001', 510, 'instagram', 'post',
  'Published staging performance fixture', 'No external media', 'pending_approval'
);
INSERT INTO tanaghom.content_approvals (content_item_id, decision, decided_by)
VALUES ('71000000-0000-4000-8000-000000000002', 'approved', '00000000-0000-4000-8000-000000000001');
UPDATE tanaghom.content_items SET status = 'approved'
WHERE id = '71000000-0000-4000-8000-000000000002';
INSERT INTO tanaghom.posts (
  id, content_item_id, provider, provider_post_id, channel, status, posted_at
) VALUES (
  '71000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000002', 'postiz',
  'postiz-performance-fixture', 'instagram', 'live', statement_timestamp()
);

SET ROLE tanaghom_api;
SELECT job_id AS first_job_id FROM tanaghom.queue_postiz_performance_sync(
  '71000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000001', 30
) \gset
SELECT job_id AS replay_job_id FROM tanaghom.queue_postiz_performance_sync(
  '71000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000001', 30
) \gset
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.agent_jobs
      WHERE job_type = 'postiz.performance.sync'
        AND input->>'post_id' = '71000000-0000-4000-8000-000000000003'
        AND status IN ('queued', 'running')) <> 1 THEN
    RAISE EXCEPTION 'active performance queue replay created a duplicate job';
  END IF;
END;
$$;

SET ROLE tanaghom_n8n_worker;
SELECT job_id AS claimed_job_id FROM tanaghom.claim_postiz_performance_job() \gset
SELECT * FROM tanaghom.prepare_postiz_performance_sync(:'claimed_job_id'::uuid);
SELECT tanaghom.complete_postiz_performance_sync(
  :'claimed_job_id'::uuid,
  '{"contract_version":"phase4.postiz-performance-result.v1","metrics":[
    {"metric_key":"impressions","metric_label":"Impressions","observed_on":"2026-07-11","value":"1200","percentage_change":12.5,"provider_metadata":{}},
    {"metric_key":"clicks","metric_label":"Clicks","observed_on":"2026-07-11","value":"48","percentage_change":4.2,"provider_metadata":{}},
    {"metric_key":"likes","metric_label":"Likes","observed_on":"2026-07-11","value":"95","percentage_change":8.1,"provider_metadata":{}},
    {"metric_key":"comments","metric_label":"Comments","observed_on":"2026-07-11","value":"12","percentage_change":null,"provider_metadata":{}}
  ]}'::jsonb
);
RESET ROLE;

SET ROLE tanaghom_api;
SELECT job_id AS second_job_id FROM tanaghom.queue_postiz_performance_sync(
  '71000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000001', 30
) \gset
RESET ROLE;
SET ROLE tanaghom_n8n_worker;
SELECT job_id AS second_claimed_job_id FROM tanaghom.claim_postiz_performance_job() \gset
SELECT * FROM tanaghom.prepare_postiz_performance_sync(:'second_claimed_job_id'::uuid);
SELECT tanaghom.record_postiz_performance_failure(
  :'second_claimed_job_id'::uuid, 'provider_unavailable',
  'Disposable retry boundary test', 503, 0
);
SELECT job_id AS retry_claimed_job_id FROM tanaghom.claim_postiz_performance_job() \gset
SELECT * FROM tanaghom.prepare_postiz_performance_sync(:'retry_claimed_job_id'::uuid);
SELECT tanaghom.complete_postiz_performance_sync(
  :'retry_claimed_job_id'::uuid,
  '{"contract_version":"phase4.postiz-performance-result.v1","metrics":[
    {"metric_key":"impressions","metric_label":"Impressions","observed_on":"2026-07-11","value":"1250","percentage_change":13.0,"provider_metadata":{}},
    {"metric_key":"clicks","metric_label":"Clicks","observed_on":"2026-07-11","value":"50","percentage_change":4.5,"provider_metadata":{}},
    {"metric_key":"likes","metric_label":"Likes","observed_on":"2026-07-11","value":"96","percentage_change":8.2,"provider_metadata":{}},
    {"metric_key":"comments","metric_label":"Comments","observed_on":"2026-07-11","value":"12","percentage_change":null,"provider_metadata":{}}
  ]}'::jsonb
);
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.post_metric_observations
      WHERE post_id = '71000000-0000-4000-8000-000000000003') <> 4 THEN
    RAISE EXCEPTION 'metric replay duplicated observations';
  END IF;
  IF (SELECT metric_value FROM tanaghom.post_metric_observations
      WHERE post_id = '71000000-0000-4000-8000-000000000003'
        AND metric_key = 'impressions') <> 1250 THEN
    RAISE EXCEPTION 'latest metric replay did not update idempotently';
  END IF;
  IF (SELECT status FROM tanaghom.post_performance_sync_state
      WHERE post_id = '71000000-0000-4000-8000-000000000003') <> 'succeeded' THEN
    RAISE EXCEPTION 'performance sync state did not complete';
  END IF;
  IF (SELECT impressions FROM tanaghom.posts
      WHERE id = '71000000-0000-4000-8000-000000000003') <> 1250 THEN
    RAISE EXCEPTION 'post aggregate was not refreshed';
  END IF;
  IF (SELECT count(*) FROM (
        SELECT operation.correlation_id
          FROM tanaghom.external_operations operation
          JOIN tanaghom.agent_jobs job ON job.correlation_id = operation.correlation_id
         WHERE job.job_type = 'postiz.performance.sync'
           AND job.input->>'post_id' = '71000000-0000-4000-8000-000000000003'
           AND operation.operation_type = 'read_analytics'
         GROUP BY operation.correlation_id
        HAVING count(DISTINCT operation.idempotency_key) = 2
       ) retry_job) <> 1 THEN
    RAISE EXCEPTION 'bounded retry did not receive a unique attempt operation';
  END IF;
END;
$$;

INSERT INTO tanaghom.leads (
  id, campaign_id, source_post_id, contact_email, status
) VALUES (
  '71000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000003', 'attributed@example.test', 'new'
);
INSERT INTO tanaghom.lead_attribution_records (
  organization_id, provider, provider_event_id, payload_fingerprint, status,
  lead_id, campaign_id, source_post_id, evidence
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'postiz', 'lead-event-attributed',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'attributed', '71000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000003', '{"match":"provider_post_id"}'
);
INSERT INTO tanaghom.lead_attribution_records (
  organization_id, provider, provider_event_id, payload_fingerprint, status,
  quarantine_reason, evidence
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'webhook', 'lead-event-unknown',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'quarantined', 'No trusted source post reference was supplied', '{"fields":["email"]}'
);

INSERT INTO tanaghom.organizations (id, slug, name)
VALUES ('71000000-0000-4000-8000-000000000099', 'phase4h-other', 'Phase 4H Other');
DO $$
BEGIN
  BEGIN
    INSERT INTO tanaghom.post_metric_observations (
      organization_id, post_id, provider, metric_key, metric_label, observed_on, metric_value
    ) VALUES (
      '71000000-0000-4000-8000-000000000099',
      '71000000-0000-4000-8000-000000000003', 'postiz', 'views', 'Views', current_date, 1
    );
    RAISE EXCEPTION 'cross-organization metric insert unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-organization metric insert unexpectedly succeeded' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO tanaghom.lead_attribution_records (
      organization_id, provider, provider_event_id, payload_fingerprint, status,
      lead_id, campaign_id, source_post_id, evidence
    ) VALUES (
      '71000000-0000-4000-8000-000000000099', 'postiz', 'cross-org-event',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'attributed', '71000000-0000-4000-8000-000000000004',
      '20000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003', '{}'
    );
    RAISE EXCEPTION 'cross-organization attribution unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-organization attribution unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;

SET ROLE tanaghom_n8n_worker;
DO $$
BEGIN
  BEGIN
    INSERT INTO tanaghom.post_metric_observations (
      organization_id, post_id, provider, metric_key, metric_label, observed_on, metric_value
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003', 'postiz', 'views', 'Views', current_date, 1
    );
    RAISE EXCEPTION 'worker direct metric insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

DELETE FROM tanaghom.lead_attribution_records
WHERE provider_event_id IN ('lead-event-attributed', 'lead-event-unknown');
DELETE FROM tanaghom.leads WHERE id = '71000000-0000-4000-8000-000000000004';
DELETE FROM tanaghom.post_metric_observations WHERE post_id = '71000000-0000-4000-8000-000000000003';
DELETE FROM tanaghom.post_performance_sync_state WHERE post_id = '71000000-0000-4000-8000-000000000003';
DELETE FROM tanaghom.outbox_events WHERE event_type LIKE 'postiz.performance_%'
  AND aggregate_id = '71000000-0000-4000-8000-000000000003';
DELETE FROM tanaghom.external_operations WHERE operation_type = 'read_analytics'
  AND correlation_id IN (SELECT correlation_id FROM tanaghom.agent_jobs WHERE job_type = 'postiz.performance.sync');
ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_update;
ALTER TABLE tanaghom.agent_actions_log DISABLE TRIGGER audit_no_delete;
DELETE FROM tanaghom.agent_actions_log WHERE action_type LIKE 'postiz.performance_%'
  AND entity_id = '71000000-0000-4000-8000-000000000003';
ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_update;
ALTER TABLE tanaghom.agent_actions_log ENABLE TRIGGER audit_no_delete;
DELETE FROM tanaghom.agent_jobs WHERE job_type = 'postiz.performance.sync'
  AND input->>'post_id' = '71000000-0000-4000-8000-000000000003';
DELETE FROM tanaghom.posts WHERE id = '71000000-0000-4000-8000-000000000003';
DELETE FROM tanaghom.content_items WHERE id = '71000000-0000-4000-8000-000000000002';
DELETE FROM tanaghom.campaign_strategies WHERE id = '71000000-0000-4000-8000-000000000001';
DELETE FROM tanaghom.organizations WHERE id = '71000000-0000-4000-8000-000000000099';
UPDATE tanaghom.integration_connections
SET status = 'disconnected', credential_ciphertext = NULL,
    credential_nonce = NULL, credential_auth_tag = NULL,
    credential_key_version = NULL, secret_last_four = NULL,
    disconnected_at = statement_timestamp()
WHERE provider = 'postiz';
UPDATE tanaghom.automation_platform_controls
SET emergency_stop = true, reason = 'Disposable performance test complete'
WHERE provider = 'postiz';
UPDATE tanaghom.agents SET status = 'idle' WHERE code = 'publisher_monitor';

SELECT 'PASS: Phase 4H performance history, replay safety, attribution quarantine, and organization boundaries enforced.' AS result;
