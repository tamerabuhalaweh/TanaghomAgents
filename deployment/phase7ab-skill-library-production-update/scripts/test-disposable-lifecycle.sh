#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }

workdir=$(mktemp -d)
cleanup() {
  rm -rf -- "$workdir"
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$workdir/deployment/dashboard-canary/secrets"
printf '%s' "$url" > "$workdir/deployment/dashboard-canary/secrets/database_url"
export TANAGHOM_PRODUCTION_ROOT=$workdir
export TANAGHOM_RELEASE_SOURCE_ROOT=$root

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
  test "$version" != 0025_runtime_agent_reconciliation || break
done

. "$root/deployment/phase7ab-skill-library-production-update/scripts/common.sh"
assert_database_at_start
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_role_registry;')" = 4
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_workflow_registry;')" = 8

for version in $PENDING_MIGRATIONS; do
  psql_file "$root/packages/database/migrations/$version.up.sql"
done
assert_skill_library_target
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_role_registry;')" = 4
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_workflow_registry;')" = 8

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO tanaghom.app_users
  (id,email,display_name,kind,role,is_active,auth_subject,accepted_at,organization_id)
VALUES (
  'f7ab0000-0000-4000-8000-000000000001',
  'phase7ab@example.test',
  'Phase 7AB Owner',
  'human',
  'owner',
  true,
  'f7ab0000-0000-4000-8000-000000000099',
  statement_timestamp(),
  '10000000-0000-4000-8000-000000000001'
);
SELECT * FROM tanaghom.create_organization_skill_draft(
  '10000000-0000-4000-8000-000000000001',
  'f7ab0000-0000-4000-8000-000000000001',
  'rollback_refusal_skill',
  'knowledge',
  'Rollback refusal skill',
  'Disposable organization guidance proving that customer Skill data blocks rollback.',
  'Use only during the isolated Phase 7AB lifecycle validation.',
  'Return a grounded proposal and escalate whenever approved evidence is absent.',
  '[]',
  ARRAY['safe_input'],
  ARRAY['safe_output'],
  'Escalate every unsupported request.',
  ARRAY['en'],
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '[]',
  NULL
);
SQL

if psql_file "$root/packages/database/migrations/0027_governed_skill_library.down.sql" 2>/dev/null; then
  echo '0027 rollback unexpectedly deleted customer Skill Library data' >&2
  exit 1
fi

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
TRUNCATE
  tanaghom.organization_skill_audit_events,
  tanaghom.organization_skill_references,
  tanaghom.organization_skill_versions,
  tanaghom.organization_skill_definitions;
SQL
psql_file "$root/packages/database/migrations/0027_governed_skill_library.down.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0026_skill_registry
assert_platform_skill_registry_exact

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO tanaghom.skill_definitions
  (id,owner_scope,code,name,description,skill_class)
VALUES (
  'f7ab0000-0000-4000-8000-000000000002',
  'platform',
  'unexpected_platform_skill',
  'Unexpected platform Skill',
  'Disposable evidence proving that changed platform registry state blocks rollback.',
  'knowledge'
);
SQL
if psql_file "$root/packages/database/migrations/0026_skill_registry.down.sql" 2>/dev/null; then
  echo '0026 rollback unexpectedly deleted changed platform Skill Registry data' >&2
  exit 1
fi
psql "$url" -X -v ON_ERROR_STOP=1 -c \
  "DELETE FROM tanaghom.skill_definitions WHERE id='f7ab0000-0000-4000-8000-000000000002';" >/dev/null
assert_platform_skill_registry_exact

psql_file "$root/packages/database/migrations/0026_skill_registry.down.sql"
assert_database_at_start
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_role_registry;')" = 4
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_workflow_registry;')" = 8

for version in $PENDING_MIGRATIONS; do
  psql_file "$root/packages/database/migrations/$version.up.sql"
done
assert_skill_library_target
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_role_registry;')" = 4
test "$(scalar 'SELECT count(*) FROM tanaghom.agent_workflow_registry;')" = 8

echo 'PASS: Phase 7AB applied 0026/0027, refused destructive rollbacks, returned to 0025, preserved existing registries, and reapplied cleanly.'
