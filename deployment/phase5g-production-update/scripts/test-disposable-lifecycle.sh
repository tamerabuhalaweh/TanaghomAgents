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

for file in "$root"/packages/database/migrations/*.up.sql; do
  version=$(basename "$file" .up.sql)
  psql_file "$file"
  test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = "$version"
  test "$version" != 0019_notification_monitoring_destinations || break
done

test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0019_notification_monitoring_destinations

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO tanaghom.app_users
  (id,email,display_name,kind,role,is_active,organization_id)
VALUES
  ('f5000000-0000-4000-8000-000000000001','phase5g-disposable@example.test','Phase 5G Test','human','owner',true,'10000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO tanaghom.notification_destinations
  (organization_id,channel,label,target_ciphertext,target_nonce,target_auth_tag,target_key_version,target_last_four,configured_by)
VALUES
  ('10000000-0000-4000-8000-000000000001','email','Pre-existing migration 0019 data',decode('00','hex'),decode('00','hex'),decode('00','hex'),1,'test','f5000000-0000-4000-8000-000000000001');
SQL

psql_file "$root/packages/database/migrations/0020_quality_rollout_control.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0020_quality_rollout_control
test "$(scalar "SELECT count(*) FROM tanaghom.quality_rollout_policies WHERE current_stage<>'baseline';")" = 0
test "$(scalar 'SELECT (SELECT count(*) FROM tanaghom.quality_evaluation_snapshots)+(SELECT count(*) FROM tanaghom.quality_rollout_decisions);')" = 0
test "$(scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.quality_rollout_policies','SELECT,INSERT,UPDATE,DELETE');")" = f
test "$(scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.quality_evaluation_snapshots','SELECT,INSERT,UPDATE,DELETE');")" = f
test "$(scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.quality_rollout_policies','UPDATE');")" = f
test "$(scalar 'SELECT count(*) FROM tanaghom.notification_destinations;')" = 1

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO tanaghom.quality_evaluation_snapshots (
  organization_id,cohort,period_start,period_end,sample_size,
  version_attribution,limitations,source_reference,recorded_by
) VALUES (
  '10000000-0000-4000-8000-000000000001','human_baseline',
  statement_timestamp()-interval '1 day',statement_timestamp(),25,
  '{"model":"human","prompt":"baseline-v1","knowledge":"catalog-v1","policy":"manual-v1","campaign":"test-v1"}',
  'Disposable rollback refusal evidence.','phase5g-production-update',
  'f5000000-0000-4000-8000-000000000001'
);
SQL

if psql_file "$root/packages/database/migrations/0020_quality_rollout_control.down.sql"; then
  echo '0020 rollback unexpectedly accepted quality evidence' >&2
  exit 1
fi
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0020_quality_rollout_control
test "$(scalar 'SELECT count(*) FROM tanaghom.quality_evaluation_snapshots;')" = 1
test "$(scalar 'SELECT count(*) FROM tanaghom.notification_destinations;')" = 1

psql "$url" -X -v ON_ERROR_STOP=1 -c 'TRUNCATE tanaghom.quality_rollout_decisions,tanaghom.quality_evaluation_snapshots;' >/dev/null
psql_file "$root/packages/database/migrations/0020_quality_rollout_control.down.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0019_notification_monitoring_destinations
test "$(scalar "SELECT to_regclass('tanaghom.quality_rollout_policies') IS NULL;")" = t
test "$(scalar 'SELECT count(*) FROM tanaghom.notification_destinations;')" = 1

psql_file "$root/packages/database/migrations/0020_quality_rollout_control.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0020_quality_rollout_control
test "$(scalar 'SELECT count(*) FROM tanaghom.notification_destinations;')" = 1

echo 'PASS: migration 0020 preserved existing data, refused evidence loss, rolled back cleanly, and reapplied in a disposable database.'
