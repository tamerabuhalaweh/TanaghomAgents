#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }

psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
scalar() { psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; }

for file in "$root"/packages/database/migrations/*.up.sql; do
  version=$(basename "$file" .up.sql)
  psql_file "$file"
  test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = "$version"
  test "$version" != 0020_quality_rollout_control || break
done
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0020_quality_rollout_control

psql_file "$root/packages/database/migrations/0021_quality_baseline_shadow_pipeline.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0021_quality_baseline_shadow_pipeline
test "$(scalar 'SELECT count(*) FROM tanaghom.quality_metric_program_versions;')" = 0
test "$(scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.quality_shadow_jobs','SELECT,INSERT,UPDATE,DELETE');")" = f
test "$(scalar "SELECT has_function_privilege('tanaghom_n8n_worker','tanaghom.claim_quality_shadow_job()','EXECUTE');")" = t
test "$(scalar "SELECT has_function_privilege('tanaghom_conversation_worker','tanaghom.claim_quality_shadow_job()','EXECUTE');")" = f

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO tanaghom.app_users (id,email,display_name,kind,role,is_active,auth_subject,accepted_at,organization_id)
VALUES ('f5100000-0000-4000-8000-000000000001','phase5g-shadow@example.test','Phase 5G Shadow Test','human','owner',true,'f5100000-0000-4000-8000-000000000002',statement_timestamp(),'10000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO tanaghom.quality_metric_program_versions
  (organization_id,version_number,status,formulas,thresholds,notes,created_by,approved_by,approved_at)
VALUES ('10000000-0000-4000-8000-000000000001',1,'approved','{}','{}','Disposable rollback refusal evidence.',
  'f5100000-0000-4000-8000-000000000001','f5100000-0000-4000-8000-000000000001',statement_timestamp());
SQL

if psql_file "$root/packages/database/migrations/0021_quality_baseline_shadow_pipeline.down.sql"; then
  echo '0021 rollback unexpectedly accepted metric evidence' >&2; exit 1
fi
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0021_quality_baseline_shadow_pipeline
psql "$url" -X -v ON_ERROR_STOP=1 -c 'TRUNCATE tanaghom.quality_shadow_results,tanaghom.quality_shadow_jobs,tanaghom.quality_evaluation_cases,tanaghom.quality_evaluation_datasets,tanaghom.quality_metric_program_versions CASCADE;' >/dev/null
psql_file "$root/packages/database/migrations/0021_quality_baseline_shadow_pipeline.down.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0020_quality_rollout_control
test "$(scalar "SELECT to_regclass('tanaghom.quality_metric_program_versions') IS NULL;")" = t
test "$(scalar 'SELECT count(*) FROM tanaghom.quality_rollout_policies;')" -ge 1
psql_file "$root/packages/database/migrations/0021_quality_baseline_shadow_pipeline.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0021_quality_baseline_shadow_pipeline

echo 'PASS: migration 0021 preserved migration-0020 state, refused evidence loss, rolled back cleanly, and reapplied.'
