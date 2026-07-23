#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }

psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
scalar() { psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; }

for file in "$root"/packages/database/migrations/*.up.sql; do
  version=$(basename "$file" .up.sql)
  test "$version" = 0029_organization_agent_studio && break
  psql_file "$file"
done
test "$(scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = 0028_strategy_cadence_integrity
psql_file "$root/packages/database/migrations/0029_organization_agent_studio.up.sql"
test "$(scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = 0029_organization_agent_studio
test "$(scalar "SELECT count(*) FROM tanaghom.agent_studio_templates;")" = 3
test "$(scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.organization_agent_versions','SELECT,INSERT,UPDATE,DELETE');")" = f

psql "$url" -X -v ON_ERROR_STOP=1 -c "
  INSERT INTO tanaghom.app_users(
    id,email,display_name,kind,role,is_active,auth_subject,accepted_at,organization_id
  ) VALUES (
    'f7000000-0000-4000-8000-000000000003',
    'phase7c@example.test','Phase 7C Owner','human','owner',true,
    'f7000000-0000-4000-8000-000000000093',now(),
    '10000000-0000-4000-8000-000000000001'
  );
  INSERT INTO tanaghom.organization_agent_definitions(organization_id,code,created_by)
  VALUES (
    '10000000-0000-4000-8000-000000000001',
    'disposable_agent',
    'f7000000-0000-4000-8000-000000000003'
  );" >/dev/null

if psql_file "$root/packages/database/migrations/0029_organization_agent_studio.down.sql" 2>/dev/null; then
  echo '0029 rollback unexpectedly deleted organization agent data' >&2
  exit 1
fi
psql "$url" -X -v ON_ERROR_STOP=1 -c "
  TRUNCATE tanaghom.organization_agent_audit_events,
    tanaghom.organization_agent_test_scenarios,
    tanaghom.organization_agent_policies,
    tanaghom.organization_agent_integration_bindings,
    tanaghom.organization_agent_skill_bindings,
    tanaghom.organization_agent_versions,
    tanaghom.organization_agent_definitions;" >/dev/null
psql_file "$root/packages/database/migrations/0029_organization_agent_studio.down.sql"
test "$(scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = 0028_strategy_cadence_integrity
test "$(scalar "SELECT to_regclass('tanaghom.organization_agent_versions') IS NULL;")" = t
psql_file "$root/packages/database/migrations/0029_organization_agent_studio.up.sql"
test "$(scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = 0029_organization_agent_studio

echo 'PASS: Phase 7C migration applies, refuses destructive rollback, rolls back empty, and reapplies cleanly.'
