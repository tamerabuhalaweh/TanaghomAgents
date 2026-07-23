#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }

psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
scalar() { psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; }

for file in "$root"/packages/database/migrations/*.up.sql; do
  version=$(basename "$file" .up.sql)
  test "$version" = 0027_governed_skill_library && break
  psql_file "$file"
done
test "$(scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = 0026_skill_registry
psql_file "$root/packages/database/migrations/0027_governed_skill_library.up.sql"
test "$(scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = 0027_governed_skill_library
test "$(scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.organization_skill_versions','SELECT,INSERT,UPDATE,DELETE');")" = f

psql "$url" -X -v ON_ERROR_STOP=1 -c "
  INSERT INTO tanaghom.app_users(id,email,display_name,kind,role,is_active,auth_subject,accepted_at,organization_id)
  VALUES (
    'f7000000-0000-4000-8000-000000000001','phase7b@example.test','Phase 7B Owner',
    'human','owner',true,'f7000000-0000-4000-8000-000000000099',now(),
    '10000000-0000-4000-8000-000000000001'
  );
  SELECT * FROM tanaghom.create_organization_skill_draft(
    '10000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001',
    'disposable_skill','knowledge','Disposable skill',
    'Disposable organization guidance used only for rollback refusal validation.',
    'Use only during the isolated Phase 7B migration test.',
    'Return a grounded proposal and escalate whenever approved evidence is absent.',
    '[]',ARRAY['safe_input'],ARRAY['safe_output'],'Escalate every unsupported request.',
    ARRAY['en'],'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','[]',NULL
  );" >/dev/null

if psql_file "$root/packages/database/migrations/0027_governed_skill_library.down.sql" 2>/dev/null; then
  echo '0027 rollback unexpectedly deleted customer Skill Library data' >&2
  exit 1
fi
psql "$url" -X -v ON_ERROR_STOP=1 -c "
  TRUNCATE tanaghom.organization_skill_audit_events,
    tanaghom.organization_skill_references,
    tanaghom.organization_skill_versions,
    tanaghom.organization_skill_definitions;" >/dev/null
psql_file "$root/packages/database/migrations/0027_governed_skill_library.down.sql"
test "$(scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = 0026_skill_registry
test "$(scalar "SELECT to_regclass('tanaghom.organization_skill_definitions') IS NULL;")" = t
psql_file "$root/packages/database/migrations/0027_governed_skill_library.up.sql"
test "$(scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = 0027_governed_skill_library

echo 'PASS: Phase 7B migration applies, rejects data-destructive rollback, rolls back empty, and reapplies cleanly.'
