#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || {
  echo 'DATABASE_TEST_URL is required' >&2
  exit 2
}
if command -v psql >/dev/null 2>&1; then
  psql_command=psql
elif command -v psql.exe >/dev/null 2>&1; then
  psql_command=psql.exe
else
  echo 'psql is required' >&2
  exit 2
fi
native_path() {
  if echo "$psql_command" | grep -q '\.exe$' &&
    command -v wslpath >/dev/null 2>&1
  then
    wslpath -w "$1"
  else
    printf '%s\n' "$1"
  fi
}

scalar() {
  "$psql_command" "$url" -X -v ON_ERROR_STOP=1 -At -c "$1" | tr -d '\r'
}
apply() {
  "$psql_command" "$url" -X -v ON_ERROR_STOP=1 \
    -f "$(native_path "$1")" >/dev/null
}

test "$(scalar "SELECT to_regclass('public.schema_migrations') IS NULL;")" = t ||
  { echo 'disposable database must start empty' >&2; exit 3; }
for migration in "$root"/packages/database/migrations/*.up.sql; do
  case "$migration" in
    *0032_gemma_served_model_profile.up.sql|*0033_agent_runtime_certification_evidence.up.sql) continue ;;
  esac
  apply "$migration"
done
test "$(scalar "
  SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;
")" = 0031_policy_runtime_executors_certification

up="$root/packages/database/migrations/0032_gemma_served_model_profile.up.sql"
down="$root/packages/database/migrations/0032_gemma_served_model_profile.down.sql"
apply "$up"
apply "$root/packages/database/tests/gemma_served_model_profile.sql"
test "$(scalar "
  SELECT count(*) FROM tanaghom.agent_runtime_profiles
   WHERE id='7d000000-0000-4000-8000-000000000002'
     AND model_name='gemma4-26b-a4b-canary';
")" = 1
apply "$down"
test "$(scalar "
  SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;
")" = 0031_policy_runtime_executors_certification
test "$(scalar "
  SELECT count(*) FROM tanaghom.agent_runtime_profiles
   WHERE id='7d000000-0000-4000-8000-000000000002';
")" = 0
apply "$up"
apply "$root/packages/database/tests/gemma_served_model_profile.sql"

echo 'PASS: disposable PostgreSQL applied, verified, rolled back and reapplied the immutable served-model profile.'
