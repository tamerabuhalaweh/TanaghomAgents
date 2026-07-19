#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }

psql_file() {
  psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null
}

scalar() {
  psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"
}

registry_matches_reviewed_contract() {
  test "$(scalar "SELECT string_agg(code,',' ORDER BY code) FROM tanaghom.agent_role_registry;")" = 'campaign_strategist,content_producer,publisher_monitor,sales_crm' &&
  test "$(scalar "SELECT string_agg(code,',' ORDER BY code) FROM tanaghom.agent_workflow_registry;")" = 'campaign_content_generator,campaign_strategy_generator,ghl_contact_sync,governed_ghl_actions,postiz_draft_publisher,postiz_performance_monitor,quality_shadow_evaluator' &&
  test "$(scalar "SELECT count(*) FROM tanaghom.agent_role_registry WHERE contract_version<>'tanaghom.agent-registry.v1';")" = 0 &&
  test "$(scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE contract_version<>'tanaghom.agent-registry.v1';")" = 0 &&
  test "$(scalar "SELECT count(*) FROM tanaghom.agent_role_registry WHERE updated_at<>created_at;")" = 0 &&
  test "$(scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE updated_at<>created_at;")" = 0
}

for file in "$root"/packages/database/migrations/*.up.sql; do
  version=$(basename "$file" .up.sql)
  psql_file "$file"
  test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = "$version"
  test "$version" != 0021_quality_baseline_shadow_pipeline || break
done

test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0021_quality_baseline_shadow_pipeline

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO tanaghom.app_users
  (id,email,display_name,kind,role,is_active,organization_id)
VALUES
  ('f6000000-0000-4000-8000-000000000001','phase6-registry@example.test','Phase 6 Registry Test','human','owner',true,'10000000-0000-4000-8000-000000000001');
INSERT INTO tanaghom.quality_evaluation_snapshots (
  organization_id,cohort,period_start,period_end,sample_size,
  version_attribution,limitations,source_reference,recorded_by
) VALUES (
  '10000000-0000-4000-8000-000000000001','human_baseline',
  statement_timestamp()-interval '1 day',statement_timestamp(),25,
  '{"model":"human","prompt":"baseline-v1","knowledge":"catalog-v1","policy":"manual-v1","campaign":"test-v1"}',
  'Existing migration 0021 evidence.','phase6-agent-registry-update',
  'f6000000-0000-4000-8000-000000000001'
);
SQL

psql_file "$root/packages/database/migrations/0022_agent_registry.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0022_agent_registry
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_role_registry;')" = 4
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_workflow_registry;')" = 7
test "$(scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='active';")" = 0
test "$(scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='imported_inactive';")" = 4
test "$(scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='available_not_imported';")" = 3
test "$(scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.agent_workflow_registry','SELECT,INSERT,UPDATE,DELETE');")" = f
test "$(scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.agent_workflow_registry','SELECT,INSERT,UPDATE,DELETE');")" = f
test "$(scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.agent_workflow_registry','SELECT');")" = t
test "$(scalar 'SELECT count(*) FROM tanaghom.quality_evaluation_snapshots;')" = 1
registry_matches_reviewed_contract

psql "$url" -X -v ON_ERROR_STOP=1 -c "INSERT INTO tanaghom.agent_role_registry(code,name,short_name,responsibility,display_order) VALUES ('unexpected_role','Unexpected role','Unexpected','Disposable evidence proving that altered registry state blocks package rollback.',99);" >/dev/null
if registry_matches_reviewed_contract; then
  echo '0022 rollback guard unexpectedly accepted modified registry evidence' >&2
  exit 1
fi
psql "$url" -X -v ON_ERROR_STOP=1 -c "DELETE FROM tanaghom.agent_role_registry WHERE code='unexpected_role';" >/dev/null
registry_matches_reviewed_contract

psql_file "$root/packages/database/migrations/0022_agent_registry.down.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0021_quality_baseline_shadow_pipeline
test "$(scalar "SELECT to_regclass('tanaghom.agent_role_registry') IS NULL;")" = t
test "$(scalar "SELECT to_regclass('tanaghom.agent_workflow_registry') IS NULL;")" = t
test "$(scalar 'SELECT count(*) FROM tanaghom.quality_evaluation_snapshots;')" = 1

psql_file "$root/packages/database/migrations/0022_agent_registry.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0022_agent_registry
registry_matches_reviewed_contract
test "$(scalar 'SELECT count(*) FROM tanaghom.quality_evaluation_snapshots;')" = 1

echo 'PASS: migration 0022 preserved migration-0021 evidence, enforced rollback contract checks, rolled back cleanly, and reapplied.'
