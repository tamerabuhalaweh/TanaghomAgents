#!/bin/sh
set -eu

export PGPASSWORD="$(cat /run/secrets/postgres_password)"
psql_base="psql -X -v ON_ERROR_STOP=1 -h postgres -U postgres -d tanaghom_demo"

ready=false
for _ in $(seq 1 30); do
  if $psql_base -Atc "SELECT 1" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if ! $ready; then
  echo "database_not_ready" >&2
  exit 1
fi

for migration in /migrations/*.up.sql; do
  version="$(basename "$migration" .up.sql)"
  if [ "$($psql_base -Atc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" = "t" ]; then
    applied="$($psql_base -Atc "SELECT count(*) FROM public.schema_migrations WHERE version='$version'")"
  else
    applied=0
  fi
  if [ "$applied" = "1" ]; then
    continue
  fi
  echo "Applying $version"
  $psql_base -f "$migration" >/dev/null
done

API_PASSWORD="$(cat /run/secrets/api_password)"
WORKSPACE_PASSWORD="$(cat /run/secrets/workspace_password)"
export API_PASSWORD WORKSPACE_PASSWORD
$psql_base -f /demo-sql/configure-api-role.sql
unset API_PASSWORD WORKSPACE_PASSWORD
$psql_base -f /seeds/creative_templates.sql >/dev/null
$psql_base -f /seeds/creative_motion_templates.sql >/dev/null
$psql_base -f /demo-sql/demo_seed.sql

# Resilient to later migrations: require the reviewed workspace baseline, not
# an exact row count that any future migration would invalidate.
test "$($psql_base -Atc "SELECT count(*) FROM public.schema_migrations WHERE version='0049_tenant_auth'")" = "1"
count="$($psql_base -Atc "SELECT count(*) FROM public.schema_migrations")"
last="$($psql_base -Atc "SELECT max(version) FROM public.schema_migrations")"
echo "DEMO_DATABASE_READY migrations=$count ledger=$last"
