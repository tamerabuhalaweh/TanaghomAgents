#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }

psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
scalar() { psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; }

fingerprint() {
  scalar "SELECT md5(jsonb_build_object(
    'campaigns', (SELECT jsonb_agg(to_jsonb(c) - 'content_item_target' ORDER BY c.id) FROM tanaghom.campaigns c),
    'jobs', (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM tanaghom.agent_jobs j),
    'content', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM tanaghom.content_items i),
    'approvals', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM tanaghom.content_approvals a),
    'actions', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM tanaghom.agent_actions_log l),
    'outbox', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM tanaghom.outbox_events o)
  )::text);"
}

registry_fingerprint() {
  scalar "SELECT md5(jsonb_build_object(
    'roles', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.code) FROM tanaghom.agent_role_registry r),
    'workflows', (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.code) FROM tanaghom.agent_workflow_registry w)
  )::text);"
}

for file in "$root"/packages/database/migrations/*.up.sql; do
  version=$(basename "$file" .up.sql)
  psql_file "$file"
  test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = "$version"
  test "$version" != 0022_agent_registry || break
done
psql_file "$root/packages/database/seeds/staging.sql"

test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0022_agent_registry
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_role_registry;')" = 4
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_workflow_registry;')" = 7
scalar "UPDATE tanaghom.agent_workflow_registry SET runtime_evidence='historical-reviewed-import' WHERE code='campaign_strategy_generator' RETURNING code;" >/dev/null
test "$(scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE updated_at<>created_at;")" = 1
registry_baseline=$(registry_fingerprint)
baseline=$(fingerprint)

psql_file "$root/packages/database/migrations/0023_campaign_lifecycle.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0023_campaign_lifecycle
test "$(scalar "SELECT count(*) FROM information_schema.columns WHERE table_schema='tanaghom' AND table_name='campaigns' AND column_name='content_item_target' AND data_type='integer' AND is_nullable='NO';")" = 1
test "$(scalar 'SELECT count(*) FROM tanaghom.campaigns WHERE content_item_target<>2;')" = 0
test "$(scalar "SELECT count(*) FROM pg_indexes WHERE schemaname='tanaghom' AND indexname='agent_jobs_one_open_core_job_per_campaign_idx' AND indexdef LIKE 'CREATE UNIQUE INDEX%';")" = 1
for signature in \
  'tanaghom.create_campaign_draft(uuid,text,text,text,jsonb,numeric,numeric,text,integer)' \
  'tanaghom.revise_campaign_brief(uuid,uuid,text,text,text,jsonb,numeric,numeric,text,integer)' \
  'tanaghom.queue_campaign_strategy(uuid,uuid)' \
  'tanaghom.queue_campaign_content(uuid,uuid)' \
  'tanaghom.reconcile_campaign_content_jobs(uuid,uuid)' \
  'tanaghom.mark_campaign_ready(uuid,uuid)'; do
  test "$(scalar "SELECT has_function_privilege('tanaghom_api','$signature','EXECUTE');")" = t
  test "$(scalar "SELECT has_function_privilege('tanaghom_n8n_worker','$signature','EXECUTE');")" = f
  test "$(scalar "SELECT count(*) FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) acl WHERE p.oid='$signature'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE';")" = 0
done
test "$(fingerprint)" = "$baseline"
test "$(registry_fingerprint)" = "$registry_baseline"

psql "$url" -X -q -v ON_ERROR_STOP=1 -v registry_baseline="$registry_baseline" >/dev/null <<'SQL'
BEGIN;
SELECT set_config('tanaghom.test_registry_baseline', :'registry_baseline', true);
UPDATE tanaghom.agent_workflow_registry
SET runtime_evidence='transaction-time-unreviewed-change'
WHERE code='campaign_strategy_generator';
DO $$
DECLARE current_fingerprint text;
BEGIN
  IF (SELECT count(*) FROM tanaghom.agent_workflow_registry
      WHERE code='campaign_strategy_generator'
        AND runtime_evidence='transaction-time-unreviewed-change') <> 1 THEN
    RAISE EXCEPTION 'Agent Registry mutation was not visible to the transaction guard';
  END IF;
  SELECT md5(jsonb_build_object(
    'roles', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.code) FROM tanaghom.agent_role_registry r),
    'workflows', (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.code) FROM tanaghom.agent_workflow_registry w)
  )::text) INTO current_fingerprint;
  IF current_fingerprint = current_setting('tanaghom.test_registry_baseline') THEN
    RAISE EXCEPTION 'Agent Registry fingerprint did not detect a transaction-time mutation';
  END IF;
END;
$$;
ROLLBACK;
SQL
test "$(registry_fingerprint)" = "$registry_baseline"

psql "$url" -X -q -v ON_ERROR_STOP=1 -v baseline="$baseline" >/dev/null <<'SQL'
BEGIN;
SELECT set_config('tanaghom.test_baseline', :'baseline', true);
SET ROLE tanaghom_api;
SELECT campaign_id AS created_id FROM tanaghom.create_campaign_draft(
  '00000000-0000-4000-8000-000000000001',
  'Disposable lifecycle campaign.test',
  'This disposable brief proves the governed campaign creation path without any provider action.',
  'camp',
  '{"audience":"Families evaluating a safe summer camp","geography":"Jordan","languages":["en","ar"]}',
  0,0,'USD',3
) \gset
RESET ROLE;
SELECT set_config('tanaghom.test_created_id', :'created_id', true);
DO $$
DECLARE current_fingerprint text;
BEGIN
  IF (SELECT count(*) FROM tanaghom.agent_actions_log
      WHERE entity_id=current_setting('tanaghom.test_created_id')::uuid
        AND action_type='campaign.created') <> 1 THEN
    RAISE EXCEPTION 'governed campaign creation did not record one immutable audit';
  END IF;
  IF (SELECT count(*) FROM tanaghom.external_operations) <> 0 THEN
    RAISE EXCEPTION 'governed campaign creation produced an external operation';
  END IF;
  SELECT md5(jsonb_build_object(
    'campaigns', (SELECT jsonb_agg(to_jsonb(c) - 'content_item_target' ORDER BY c.id) FROM tanaghom.campaigns c),
    'jobs', (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM tanaghom.agent_jobs j),
    'content', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM tanaghom.content_items i),
    'approvals', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM tanaghom.content_approvals a),
    'actions', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM tanaghom.agent_actions_log l),
    'outbox', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM tanaghom.outbox_events o)
  )::text) INTO current_fingerprint;
  IF current_fingerprint = current_setting('tanaghom.test_baseline') THEN
    RAISE EXCEPTION 'campaign lifecycle fingerprint did not detect a governed mutation';
  END IF;
END;
$$;
ROLLBACK;
SQL
test "$(fingerprint)" = "$baseline"

psql "$url" -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
BEGIN;
UPDATE tanaghom.campaigns SET content_item_target=3 WHERE id='20000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF (SELECT count(*) FROM tanaghom.campaigns WHERE content_item_target<>2) = 0 THEN
    RAISE EXCEPTION 'content-target rollback guard did not detect changed evidence';
  END IF;
END;
$$;
ROLLBACK;
SQL
test "$(fingerprint)" = "$baseline"

psql_file "$root/packages/database/migrations/0023_campaign_lifecycle.down.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0022_agent_registry
test "$(scalar "SELECT count(*) FROM information_schema.columns WHERE table_schema='tanaghom' AND table_name='campaigns' AND column_name='content_item_target';")" = 0
test "$(scalar "SELECT to_regprocedure('tanaghom.create_campaign_draft(uuid,text,text,text,jsonb,numeric,numeric,text,integer)') IS NULL;")" = t
test "$(scalar 'SELECT count(*) FROM tanaghom.campaigns;')" = 1
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_role_registry;')" = 4
test "$(fingerprint)" = "$baseline"
test "$(registry_fingerprint)" = "$registry_baseline"

psql_file "$root/packages/database/migrations/0023_campaign_lifecycle.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0023_campaign_lifecycle
test "$(fingerprint)" = "$baseline"
test "$(registry_fingerprint)" = "$registry_baseline"
test "$(scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0

echo 'PASS: migration 0023 is additive, least-privileged, data-safe, rollback-guarded, reversible, provider-free, and compatible with historically reconciled Agent Registry rows.'
