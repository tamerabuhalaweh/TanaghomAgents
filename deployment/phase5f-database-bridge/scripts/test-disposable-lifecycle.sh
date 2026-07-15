#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }
workdir=$(mktemp -d)
cleanup() { rm -rf -- "$workdir"; }
trap cleanup EXIT HUP INT TERM
mkdir -p "$workdir/deployment/dashboard-canary/secrets"
printf '%s' "$url" > "$workdir/deployment/dashboard-canary/secrets/database_url"
export TANAGHOM_PRODUCTION_ROOT=$workdir

psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
scalar() { psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; }

for file in "$root"/packages/database/migrations/*.up.sql; do
  version=$(basename "$file" .up.sql)
  psql_file "$file"
  test "$version" != 0009_postiz_automation_controls || break
done
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0009_postiz_automation_controls

for version in 0010_postiz_performance_monitoring 0011_ghl_contact_sync 0012_ghl_inbound_event_inbox 0013_sales_knowledge_intelligence 0014_supervised_conversation_ownership; do psql_file "$root/packages/database/migrations/$version.up.sql"; done
. "$root/deployment/phase5f-database-bridge/scripts/common.sh"
assert_bridge_default_state

psql "$url" -X -v ON_ERROR_STOP=1 -c "UPDATE tanaghom.organization_crm_policies SET contact_sync_mode='paused';" >/dev/null
if (assert_bridge_default_state) >/dev/null 2>&1; then echo 'bridge default guard accepted customer policy changes' >&2; exit 1; fi
psql "$url" -X -v ON_ERROR_STOP=1 -c "UPDATE tanaghom.organization_crm_policies SET contact_sync_mode='manual';" >/dev/null
assert_bridge_default_state

for version in 0014_supervised_conversation_ownership 0013_sales_knowledge_intelligence 0012_ghl_inbound_event_inbox 0011_ghl_contact_sync 0010_postiz_performance_monitoring; do psql_file "$root/packages/database/migrations/$version.down.sql"; done
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0009_postiz_automation_controls
test "$(scalar "SELECT count(*) FROM pg_roles WHERE rolname='tanaghom_conversation_worker';")" = 0
test "$(scalar "SELECT to_regclass('tanaghom.conversations') IS NULL;")" = t

for version in 0010_postiz_performance_monitoring 0011_ghl_contact_sync 0012_ghl_inbound_event_inbox 0013_sales_knowledge_intelligence 0014_supervised_conversation_ownership; do psql_file "$root/packages/database/migrations/$version.up.sql"; done
assert_bridge_default_state

echo 'PASS: database bridge applied 0010-0014, refused changed policy, rolled back to 0009, and reapplied.'
