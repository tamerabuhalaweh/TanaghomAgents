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
node_command=node
node_major=$("$node_command" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if test "$node_major" -lt 22 && command -v node.exe >/dev/null 2>&1; then
  node_command=node.exe
  node_major=$("$node_command" -p 'process.versions.node.split(".")[0]')
fi
test "$node_major" -ge 22 || {
  echo 'Node.js 22 or newer is required' >&2
  exit 2
}
native_path() {
  if echo "$2" | grep -q '\.exe$' &&
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

test "$(scalar "SELECT to_regclass('public.schema_migrations') IS NULL;")" = t || {
  echo 'the Phase 7F disposable database must start empty' >&2
  exit 3
}

for migration in "$root"/packages/database/migrations/*.up.sql; do
  "$psql_command" "$url" -X -v ON_ERROR_STOP=1 \
    -f "$(native_path "$migration" "$psql_command")" >/dev/null
done
"$psql_command" "$url" -X -v ON_ERROR_STOP=1 \
  -f "$(native_path "$root/packages/database/seeds/staging.sql" "$psql_command")" >/dev/null
test "$(scalar "
  SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;
")" = 0031_policy_runtime_executors_certification

script_path=$(native_path \
  "$root/scripts/phase7d-runtime-certification-integration.mjs" \
  "$node_command")
if echo "$node_command" | grep -q '\.exe$'; then
  inherited_wslenv=${WSLENV:-}
  if test -n "$inherited_wslenv"; then
    phase7f_wslenv="$inherited_wslenv:DATABASE_TEST_URL"
  else
    phase7f_wslenv=DATABASE_TEST_URL
  fi
  output=$(
    WSLENV="$phase7f_wslenv" DATABASE_TEST_URL="$url" \
      "$node_command" "$script_path"
  )
else
  output=$(
    DATABASE_TEST_URL="$url" "$node_command" "$script_path"
  )
fi
echo "$output"
echo "$output" | grep -q \
  'two bilingual agents completed 28 canonical zero-action scenarios'
test "$(scalar "
  SELECT count(*) FROM tanaghom.organization_agent_jobs;
")" = 0
test "$(scalar "
  SELECT count(*) FROM tanaghom.agent_runtime_controls
   WHERE singleton AND emergency_stop=true;
")" = 1
test "$(scalar "
  SELECT count(*) FROM tanaghom.agent_runtime_executor_adapters WHERE enabled;
")" = 0

echo 'PASS: disposable PostgreSQL completed the full bilingual zero-action runtime suite and retained no canary state.'
