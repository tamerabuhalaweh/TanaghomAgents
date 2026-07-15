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
  test "$version" != 0014_supervised_conversation_ownership || break
done

test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0014_supervised_conversation_ownership

for version in \
  0015_governed_ghl_actions \
  0016_ghl_action_review_reconciliation \
  0017_ghl_service_action_audit_attribution \
  0018_conversation_capacity_backpressure \
  0019_notification_monitoring_destinations; do
  psql_file "$root/packages/database/migrations/$version.up.sql"
done

test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0019_notification_monitoring_destinations
test "$(scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE action_mode<>'manual' OR proactive_message_mode<>'disabled' OR action_emergency_stop IS NOT TRUE;")" = 0
test "$(scalar 'SELECT count(*) FROM tanaghom.notification_delivery_controls WHERE runtime_ready IS NOT FALSE OR emergency_stop IS NOT TRUE;')" = 0
test "$(scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.notification_destinations','SELECT,INSERT,UPDATE,DELETE');")" = f
test "$(scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.ghl_action_jobs','SELECT,INSERT,UPDATE,DELETE');")" = f

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO tanaghom.app_users
  (id,email,display_name,kind,role,is_active,organization_id)
VALUES
  ('f5000000-0000-4000-8000-000000000001','phase5f-disposable@example.test','Phase 5F Test','human','owner',true,'10000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO tanaghom.notification_destinations
  (organization_id,channel,label,target_ciphertext,target_nonce,target_auth_tag,target_key_version,target_last_four,configured_by)
VALUES
  ('10000000-0000-4000-8000-000000000001','email','Rollback refusal test',decode('00','hex'),decode('00','hex'),decode('00','hex'),1,'test','f5000000-0000-4000-8000-000000000001');
SQL

if psql_file "$root/packages/database/migrations/0019_notification_monitoring_destinations.down.sql"; then
  echo '0019 rollback unexpectedly accepted customer notification data' >&2
  exit 1
fi
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0019_notification_monitoring_destinations
test "$(scalar 'SELECT count(*) FROM tanaghom.notification_destinations;')" = 1
psql "$url" -X -v ON_ERROR_STOP=1 -c 'DELETE FROM tanaghom.notification_destinations;' >/dev/null

for version in \
  0019_notification_monitoring_destinations \
  0018_conversation_capacity_backpressure \
  0017_ghl_service_action_audit_attribution \
  0016_ghl_action_review_reconciliation \
  0015_governed_ghl_actions; do
  psql_file "$root/packages/database/migrations/$version.down.sql"
done

test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0014_supervised_conversation_ownership
test "$(scalar "SELECT to_regclass('tanaghom.notification_destinations') IS NULL;")" = t
test "$(scalar "SELECT to_regclass('tanaghom.ghl_action_jobs') IS NULL;")" = t

for version in \
  0015_governed_ghl_actions \
  0016_ghl_action_review_reconciliation \
  0017_ghl_service_action_audit_attribution \
  0018_conversation_capacity_backpressure \
  0019_notification_monitoring_destinations; do
  psql_file "$root/packages/database/migrations/$version.up.sql"
done
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0019_notification_monitoring_destinations

echo 'PASS: migrations 0015-0019 applied, refused destructive data rollback, rolled back cleanly, and reapplied in a disposable database.'
