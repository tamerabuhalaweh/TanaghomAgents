#!/bin/bash
# Shared helpers for the isolated demo backup/upgrade/restore procedure (#259).
# Sourced by demo-backup.sh, demo-upgrade.sh and demo-restore.sh. It reads no
# secret value: psql runs inside the postgres container as the local superuser.
set -euo pipefail

_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_repo_root="$(cd "$_lib_dir/../../.." && pwd)"
PROJECT="${TANAGHOM_DEMO_PROJECT:-tanaghom-dashboard-demo}"
MIGRATIONS_DIR="${TANAGHOM_DEMO_MIGRATIONS_DIR:-$_repo_root/packages/database/migrations}"
COMPOSE_FILE="${TANAGHOM_DEMO_COMPOSE_FILE:-$_lib_dir/../compose.yml}"
BACKUP_ROOT="${TANAGHOM_DEMO_BACKUP_DIR:-${TANAGHOM_DEMO_ROOT:-/opt/tanaghom-demo}/runtime/backups}"
SNAPSHOT_IMAGE="${TANAGHOM_DEMO_SNAPSHOT_IMAGE:-node:24.18.0-alpine3.24}"
PG_VOLUME="${TANAGHOM_DEMO_PG_VOLUME:-${PROJECT}-pgdata}"
BLOB_VOLUME="${TANAGHOM_DEMO_BLOB_VOLUME:-${PROJECT}-rustfsdata}"

export TANAGHOM_DEMO_SECRETS_DIR="${TANAGHOM_DEMO_SECRETS_DIR:-${TANAGHOM_DEMO_ROOT:-/opt/tanaghom-demo}/runtime/secrets}"
export TANAGHOM_DEMO_RELEASE="${TANAGHOM_DEMO_RELEASE:-local}"

# An untracked .env beside the compose file carries host-only secrets such as
# INTEGRATION_CREDENTIAL_KEY; load it explicitly so upgrades keep credentials readable.
COMPOSE_ENV_FILE="${COMPOSE_FILE%/*}/.env"
compose() {
  local args=(-p "$PROJECT")
  [ -f "$COMPOSE_ENV_FILE" ] && args+=(--env-file "$COMPOSE_ENV_FILE")
  docker compose "${args[@]}" -f "$COMPOSE_FILE" "$@"
}
psql_demo() { compose exec -T postgres psql -X -At -v ON_ERROR_STOP=1 -U postgres -d tanaghom_demo "$@"; }
refuse() { echo "DEMO_LIFECYCLE_REFUSED: $*" >&2; exit 1; }

require_docker() { docker info >/dev/null 2>&1 || refuse "docker is unavailable"; }
require_postgres() {
  require_docker
  [ -n "$(compose ps -q postgres 2>/dev/null)" ] || refuse "demo postgres is not running"
  psql_demo -c "SELECT 1" >/dev/null 2>&1 || refuse "demo database is not reachable"
}

# Row counts for every table in the demo schemas; the unit of the data-preserving
# proof. Deterministically ordered so two runs can be compared line by line.
table_counts() {
  psql_demo -c "SELECT n.nspname||'.'||c.relname||'='||(xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I',n.nspname,c.relname),false,true,'')))[1]::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','tanaghom') ORDER BY 1"
}
ledger_tail() { psql_demo -c "SELECT coalesce(max(version),'none') FROM public.schema_migrations"; }
ledger_count() { psql_demo -c "SELECT count(*) FROM public.schema_migrations"; }
ledger_versions() {
  psql_demo -c "SELECT string_agg(version, ',' ORDER BY version) FROM public.schema_migrations"
}
migration_versions() {
  find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.up.sql' -printf '%f\n' | sed 's/\.up\.sql$//' | sort
}
migration_total() { migration_versions | wc -l | tr -d '[:space:]'; }
latest_migration_version() { migration_versions | tail -n 1; }

# Proves the ledger advanced to exactly the reviewed migration chain. Leaving a
# host half-migrated is the one state the deployment must never accept.
verify_ledger_advanced() {
  local before_count="$1" total latest after_count actual expected
  total="$(migration_total)"
  latest="$(latest_migration_version)"
  after_count="$(ledger_count)"
  [ "$after_count" = "$total" ] ||
    refuse "ledger has $after_count migrations, expected $total"
  [ "$(ledger_tail)" = "$latest" ] ||
    refuse "ledger ends at $(ledger_tail), expected $latest"
  actual="$(ledger_versions)"
  expected="$(migration_versions | paste -sd, -)"
  [ "$actual" = "$expected" ] ||
    refuse "ledger rows do not match the reviewed migration chain"
  [ "$after_count" -gt "$before_count" ] ||
    refuse "no migration was applied"
  printf '%s\n' "$after_count"
}

# The only row-count change a schema upgrade may cause is the ledger itself.
verify_no_row_drift() {
  local before="$1" after="$2" report unexpected
  report="$(count_delta_report "$before" "$after")"
  unexpected="$(printf '%s\n' "$report" |
    grep -vE '^public\.schema_migrations [0-9]+->[0-9]+$' |
    grep -v '^$' || true)"
  if [ -n "$unexpected" ]; then
    echo "ROW_COUNT_DRIFT:" >&2
    printf '%s\n' "$unexpected" >&2
    refuse "the upgrade changed rows it must not touch"
  fi
}
profile_present() {
  psql_demo -c "SELECT count(*) FROM tanaghom.agent_runtime_profiles WHERE id='7d000000-0000-4000-8000-000000000003'"
}
blob_count() {
  docker run --rm --entrypoint sh -v "$BLOB_VOLUME":/data:ro "$SNAPSHOT_IMAGE" \
    -c 'find /data -type f | wc -l' | tr -d '[:space:]'
}
blob_names_hash() {
  docker run --rm --entrypoint sh -v "$BLOB_VOLUME":/data:ro "$SNAPSHOT_IMAGE" \
    -c 'cd /data && find . -type f | sort | sha256sum' | cut -d' ' -f1
}
file_sha() { sha256sum "$1" | cut -d' ' -f1; }
latest_backup() { [ -L "$BACKUP_ROOT/latest" ] && readlink -f "$BACKUP_ROOT/latest" || true; }

verify_backup() {
  local dir="$1"
  [ -d "$dir" ] || refuse "backup directory not found: $dir"
  [ -s "$dir/database.dump" ] || refuse "backup dump is missing: $dir/database.dump"
  [ -f "$dir/manifest.json" ] || refuse "backup manifest is missing: $dir/manifest.json"
  [ "$(file_sha "$dir/database.dump")" = "$(jq -r .dump_sha256 "$dir/manifest.json")" ] ||
    refuse "backup database checksum does not match the manifest"
  [ "$(file_sha "$dir/rustfs.tar")" = "$(jq -r .rustfs_sha256 "$dir/manifest.json")" ] ||
    refuse "backup object archive checksum does not match the manifest"
  local auth_hash
  auth_hash="$(jq -r '.auth_sha256 // "none"' "$dir/manifest.json")"
  if [ "$auth_hash" != "none" ]; then
    [ -s "$dir/auth-users.json" ] || refuse "backup account store is missing: $dir/auth-users.json"
    [ "$(file_sha "$dir/auth-users.json")" = "$auth_hash" ] ||
      refuse "backup account-store checksum does not match the manifest"
  fi
  # grep -q closes the pipe as soon as it matches, which kills pg_restore with
  # SIGPIPE; under pipefail that reads as a failed verification. List to a file.
  local toc
  toc="$(mktemp)"
  if ! compose exec -T postgres pg_restore -l < "$dir/database.dump" > "$toc"; then
    rm -f "$toc"
    refuse "the backup dump cannot be listed"
  fi
  if ! grep -q 'TABLE DATA' "$toc"; then
    rm -f "$toc"
    refuse "backup dump has no table data"
  fi
  rm -f "$toc"
  printf '%s\n' "$dir"
}

# Prints "table=before->after" lines for every table whose row count changed.
count_delta_report() {
  awk -F= 'NR==FNR{b[$1]=$2; next} { if(!($1 in b)) print $1" new="$2; else if(b[$1]!=$2) print $1" "b[$1]"->"$2 }' "$1" "$2"
}

wait_healthy() {
  local service="$1" id status
  for _ in $(seq 1 60); do
    id="$(compose ps -q "$service" 2>/dev/null || true)"
    if [ -n "$id" ]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)"
      [ "$status" = healthy ] && { echo "$service healthy"; return 0; }
    fi
    sleep 3
  done
  refuse "$service did not become healthy"
}

# Phase 1 contract: the host .env sets AGENCY_WORKSPACE_ENABLED=true and the
# worker runs in the "workspace" profile, so a plain `up -d` never starts it.
# Upgrade and restore stop the worker to quiesce the stack; they must bring it
# back or the host silently loses its model worker while the flag stays true.
# Reads the environment first, then the untracked compose .env, and never prints
# a value: only the resolved boolean.
workspace_enabled() {
  local value="${AGENCY_WORKSPACE_ENABLED:-}"
  if [ -z "$value" ] && [ -f "$COMPOSE_ENV_FILE" ]; then
    value="$(sed -n 's/^AGENCY_WORKSPACE_ENABLED=//p' "$COMPOSE_ENV_FILE" | tail -n 1)"
  fi
  value="${value%\"}"
  value="${value#\"}"
  [ "${value:-false}" = "true" ]
}

start_workspace_worker() {
  if ! workspace_enabled; then
    echo "WORKSPACE_WORKER_SKIPPED disabled"
    return 0
  fi
  compose --profile workspace up -d workspace-worker >/dev/null
  echo "WORKSPACE_WORKER_STARTED enabled"
}

# Rollback is a verified restore, never a volume reset. demo-restore.sh refuses
# without its authorization marker, so the caller passes it explicitly.
restore_verified_backup() {
  local dir="$1"
  verify_backup "$dir" >/dev/null
  TANAGHOM_DEMO_RESTORE_AUTHORIZATION=GO-RESTORE-TANAGHOM-259-DEMO \
    bash "$_lib_dir/demo-restore.sh" "$dir"
}
