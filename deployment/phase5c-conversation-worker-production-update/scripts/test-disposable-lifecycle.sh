#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }

psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
scalar() { psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; }

for file in "$root"/packages/database/migrations/*.up.sql; do
  version=$(basename "$file" .up.sql)
  test "$version" = 0024_conversation_intelligence_worker_registry && break
  psql_file "$file"
done
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0023_campaign_lifecycle
test "$(scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code='conversation_intelligence_worker';")" = 0

psql_file "$root/packages/database/migrations/0024_conversation_intelligence_worker_registry.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0024_conversation_intelligence_worker_registry
test "$(scalar "SELECT runtime_state||'|'||trigger_state FROM tanaghom.agent_workflow_registry WHERE code='conversation_intelligence_worker';")" = 'available_not_imported|disabled'

psql "$url" -X -v ON_ERROR_STOP=1 -c "CREATE ROLE tanaghom_conversation_runtime LOGIN PASSWORD 'disposable-only' IN ROLE tanaghom_conversation_worker;" >/dev/null
test "$(scalar "SELECT pg_has_role('tanaghom_conversation_runtime','tanaghom_conversation_worker','MEMBER');")" = t
test "$(scalar "SELECT pg_has_role('tanaghom_conversation_runtime','tanaghom_n8n_worker','MEMBER');")" = f
test "$(scalar "SELECT has_table_privilege('tanaghom_conversation_runtime','tanaghom.conversation_intelligence_proposals','SELECT,INSERT,UPDATE,DELETE');")" = f
test "$(scalar "SELECT has_function_privilege('tanaghom_conversation_runtime','tanaghom.claim_ghl_inbound_event_job()','EXECUTE');")" = t

psql "$url" -X -v ON_ERROR_STOP=1 -c "UPDATE tanaghom.agent_workflow_registry SET runtime_state='imported_inactive',runtime_evidence='disposable-test' WHERE code='conversation_intelligence_worker';" >/dev/null
if psql_file "$root/packages/database/migrations/0024_conversation_intelligence_worker_registry.down.sql"; then
  echo '0024 rollback unexpectedly accepted an imported runtime' >&2; exit 1
fi
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0024_conversation_intelligence_worker_registry

psql "$url" -X -v ON_ERROR_STOP=1 -c 'DROP ROLE tanaghom_conversation_runtime;' >/dev/null
psql "$url" -X -v ON_ERROR_STOP=1 -c "UPDATE tanaghom.agent_workflow_registry SET runtime_state='available_not_imported',trigger_state='disabled' WHERE code='conversation_intelligence_worker';" >/dev/null
psql_file "$root/packages/database/migrations/0024_conversation_intelligence_worker_registry.down.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0023_campaign_lifecycle
test "$(scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code='conversation_intelligence_worker';")" = 0

psql_file "$root/packages/database/migrations/0024_conversation_intelligence_worker_registry.up.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0024_conversation_intelligence_worker_registry

echo 'PASS: migration 0024, least-privilege runtime role, guarded rollback, and clean reapply verified.'
