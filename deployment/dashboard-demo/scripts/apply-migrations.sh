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
export API_PASSWORD
$psql_base -f /demo-sql/configure-api-role.sql
unset API_PASSWORD
$psql_base -f /seeds/creative_templates.sql >/dev/null
$psql_base -f /seeds/creative_motion_templates.sql >/dev/null
$psql_base -f /demo-sql/demo_seed.sql

count="$($psql_base -Atc "SELECT count(*) FROM public.schema_migrations")"
test "$count" = "44"
echo "DEMO_DATABASE_READY migrations=$count"
