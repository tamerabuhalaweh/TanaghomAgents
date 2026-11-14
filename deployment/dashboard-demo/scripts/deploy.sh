#!/bin/bash
set -euo pipefail

test "${TANAGHOM_DEMO_DEPLOY_AUTHORIZATION:-}" = "GO-DEPLOY-TANAGHOM-243-DEMO"
# The production operator is the ubuntu user in the docker group; root is not
# required when it owns the checkout and runtime directories. Fail early with a
# precise message rather than relying on a later docker/chmod error.
if [ "$(id -u)" != 0 ] && ! docker info >/dev/null 2>&1; then
  echo "DEMO_DEPLOY_DOCKER_ACCESS_REQUIRED: run as root or a member of the docker group" >&2
  exit 1
fi
root="${TANAGHOM_DEMO_ROOT:-/opt/tanaghom-demo}"
source_dir="$root/source"
secrets_dir="$root/runtime/secrets"
expected_release="${EXPECTED_DEMO_RELEASE:?exact reviewed demo source revision required}"

test -d "$source_dir"
cd "$source_dir"
test -z "$(git status --porcelain)"
release="$(git rev-parse HEAD)"
test "$release" = "$expected_release"

# Fresh hosts are installed from scratch. Existing hosts take the
# backup-verified, data-preserving upgrade path below; this script never removes
# a volume and never resets the database.
if ! docker info >/dev/null 2>&1; then
  echo "DOCKER_UNAVAILABLE: cannot establish whether demo volumes exist" >&2
  exit 1
fi
if ! volumes="$(docker volume ls --format '{{.Name}}')"; then
  echo "DEMO_VOLUME_DISCOVERY_FAILED: cannot verify retained data" >&2
  exit 1
fi
# An existing demo is upgraded in place: verified snapshot first, then migrate,
# then prove the ledger and row counts before serving the new release. Volumes
# and secrets are never removed or reset.
existing_demo=false
if grep -Fxq 'tanaghom-dashboard-demo-pgdata' <<<"$volumes" ||
   grep -Fxq 'tanaghom-dashboard-demo-rustfsdata' <<<"$volumes"; then
  existing_demo=true
fi

# Require the snapshot before anything else touches the existing host. Secret
# file modes are adjusted later, but no service or row changes before this.
existing_backup=""
if [ "$existing_demo" = true ]; then
  [ -d "$secrets_dir" ] || {
    echo "existing demo database volume has no runtime secrets; restore them before upgrading" >&2
    exit 1
  }
  export TANAGHOM_DEMO_ROOT="$root"
  export TANAGHOM_DEMO_RELEASE="$release"
  export TANAGHOM_DEMO_SECRETS_DIR="$secrets_dir"
  # shellcheck source=demo-lifecycle-lib.sh
  . deployment/dashboard-demo/scripts/demo-lifecycle-lib.sh
  existing_backup="$(latest_backup)"
  [ -n "$existing_backup" ] || {
    echo "UPGRADE_BACKUP_REQUIRED: run demo-backup.sh and verify it before deploying" >&2
    exit 1
  }
  verify_backup "$existing_backup" >/dev/null || {
    echo "UPGRADE_BACKUP_INVALID: $existing_backup failed verification" >&2
    exit 1
  }
  echo "UPGRADE_BACKUP_VERIFIED dir=$existing_backup"
fi

test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 10
required_secrets="postgres_password api_password database_url supabase_url supabase_publishable_key supabase_jwks_url auth_users.json auth_private_key.pem auth_internal_token s3_access_key s3_secret_key workspace_password workspace_database_url workspace_worker_token"
augment_workspace_secrets() {
  umask 077
  if [ -e "$secrets_dir/workspace_database_url" ] && [ ! -e "$secrets_dir/workspace_password" ]; then
    echo "workspace_database_url exists without workspace_password; restore the matching password" >&2
    exit 1
  fi
  if [ ! -e "$secrets_dir/workspace_password" ]; then
    openssl rand -hex 32 > "$secrets_dir/workspace_password"
  fi
  if [ ! -e "$secrets_dir/workspace_database_url" ]; then
    printf 'postgresql://tanaghom_agency_pilot_worker:%s@postgres:5432/tanaghom_demo\n' "$(cat "$secrets_dir/workspace_password")" > "$secrets_dir/workspace_database_url"
  fi
  if [ ! -e "$secrets_dir/workspace_worker_token" ]; then
    openssl rand -hex 32 > "$secrets_dir/workspace_worker_token"
  fi
  if [ ! -e "$secrets_dir/gemini_api_key" ]; then
    : > "$secrets_dir/gemini_api_key"
  fi
}
if [ ! -d "$secrets_dir" ]; then
  if docker volume inspect tanaghom-dashboard-demo-pgdata >/dev/null 2>&1; then
    echo "existing demo database volume has no runtime secrets; restore them or remove disposable demo volumes" >&2
    exit 1
  fi
  bash deployment/dashboard-demo/scripts/prepare-runtime.sh "$secrets_dir"
fi
test -d "$secrets_dir"
if [ ! -w "$secrets_dir" ]; then
  echo "DEMO_DEPLOY_SECRETS_NOT_WRITABLE: $secrets_dir must be owned by the operator or run as root" >&2
  exit 1
fi
augment_workspace_secrets
chmod 0700 "$secrets_dir"
missing=""
for name in $required_secrets; do
  path="$secrets_dir/$name"
  if [ ! -s "$path" ] || [ -L "$path" ]; then missing="$missing $name"; fi
done
if [ ! -e "$secrets_dir/gemini_api_key" ] || [ -L "$secrets_dir/gemini_api_key" ] || [ -d "$secrets_dir/gemini_api_key" ]; then
  missing="$missing gemini_api_key"
fi
if [ -n "$missing" ]; then
  echo "partial or unsafe demo secrets:$missing; stop and restore the matching secrets" >&2
  exit 1
fi
for name in $required_secrets; do chmod 0444 "$secrets_dir/$name"; done
chmod 0444 "$secrets_dir/gemini_api_key"
if [ -e "$secrets_dir/demo-credentials.txt" ]; then chmod 0600 "$secrets_dir/demo-credentials.txt"; fi
export TANAGHOM_DEMO_SECRETS_DIR="$secrets_dir"
export TANAGHOM_DEMO_RELEASE="$release"

compose=(docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml)
# The untracked host .env carries INTEGRATION_CREDENTIAL_KEY, the workspace switch
# and the Postiz allowlist; without it every compose default falls back to inert.
compose_env_file="deployment/dashboard-demo/.env"
[ -f "$compose_env_file" ] && compose+=(--env-file "$compose_env_file")
committed=false
trap 'if ! $committed; then echo "DEMO_DEPLOYMENT_NOT_COMMITTED: services left for inspection; canary untouched" >&2; "${compose[@]}" ps || true; fi' EXIT

"${compose[@]}" --profile workspace config --quiet
"${compose[@]}" --profile workspace config --format json | python3 deployment/dashboard-demo/scripts/validate-compose.py

upgrade_failed() {
  echo "UPGRADE_FAILED: $1" >&2
  echo "Restoring the verified snapshot $existing_backup" >&2
  if restore_verified_backup "$existing_backup"; then
    echo "ROLLBACK_COMPLETE ledger=$(ledger_tail)" >&2
  else
    echo "ROLLBACK_FAILED: restore from $existing_backup before serving traffic" >&2
  fi
  exit 1
}

upgrade_existing_release() {
  local dir="$existing_backup" before_count before_ledger total pending
  before_count="$(ledger_count)"
  before_ledger="$(ledger_tail)"
  total="$(migration_total)"
  pending=$((total - before_count))
  [ "$pending" -ge 0 ] || upgrade_failed "the ledger is ahead of the reviewed source"
  echo "UPGRADE_START baseline=$before_ledger pending=$pending backup=$dir"
  table_counts > "$dir/counts-deploy-before.txt"

  # Build first: a failed image build changes no data and costs no downtime.
  "${compose[@]}" build dashboard

  "${compose[@]}" stop dashboard >/dev/null 2>&1 || true
  "${compose[@]}" --profile workspace stop workspace-worker >/dev/null 2>&1 || true

  if [ "$pending" -gt 0 ]; then
    if ! "${compose[@]}" run --rm -T migrate </dev/null 2>&1 | tail -n 20; then
      upgrade_failed "the migration service failed"
    fi
    if ! ( verify_ledger_advanced "$before_count" ); then
      upgrade_failed "the ledger did not advance to the reviewed chain"
    fi
  elif [ "$(ledger_count)" != "$total" ] || [ "$(ledger_tail)" != "$(latest_migration_version)" ]; then
    upgrade_failed "the ledger is not at the reviewed chain"
  fi

  table_counts > "$dir/counts-deploy-after.txt"
  if ! ( verify_no_row_drift "$dir/counts-deploy-before.txt" "$dir/counts-deploy-after.txt" ); then
    upgrade_failed "row counts drifted during the upgrade"
  fi

  # Leave the migrate container in its exited-0 state so validate.sh can inspect
  # it, then serve the new release without touching postgres or the volumes.
  "${compose[@]}" up -d migrate >/dev/null ||
    upgrade_failed "the migrate service did not record its exited-0 state"
  # Auth code is bind-mounted; a release that changes server.mjs/store.mjs/
  # mailer.mjs must restart the process, not only rebuild the dashboard image.
  "${compose[@]}" up -d --force-recreate auth >/dev/null ||
    upgrade_failed "the auth service did not restart"
  ( wait_healthy auth ) || upgrade_failed "the auth service did not become healthy"
  "${compose[@]}" up -d dashboard >/dev/null ||
    upgrade_failed "the dashboard did not start"
  ( wait_healthy dashboard ) || upgrade_failed "the dashboard did not become healthy"
  start_workspace_worker || upgrade_failed "the workspace worker did not start"
  if ! TANAGHOM_DEMO_SECRETS_DIR="$secrets_dir" TANAGHOM_DEMO_RELEASE="$release" \
    bash deployment/dashboard-demo/scripts/validate.sh; then
    upgrade_failed "post-upgrade validation failed"
  fi
  echo "DEMO_DEPLOYMENT_COMMITTED=$release upgraded=true ledger=$(ledger_tail) backup=$dir"
}

if [ "$existing_demo" = true ]; then
  upgrade_existing_release
  committed=true
  exit 0
fi

if [ -z "$("${compose[@]}" ps -q)" ]; then
  if ss -ltn "sport = :3210" | tail -n +2 | grep -q .; then
    echo "port 3210 is already in use" >&2
    exit 1
  fi
fi

"${compose[@]}" pull postgres auth storage storage-init
"${compose[@]}" build dashboard
"${compose[@]}" up -d

for _ in $(seq 1 60); do
  dashboard_id="$("${compose[@]}" ps -q dashboard)"
  if [ -n "$dashboard_id" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' "$dashboard_id")" = healthy ]; then
    break
  fi
  sleep 3
done

TANAGHOM_DEMO_SECRETS_DIR="$secrets_dir" TANAGHOM_DEMO_RELEASE="$release" bash deployment/dashboard-demo/scripts/validate.sh
committed=true
echo "DEMO_DEPLOYMENT_COMMITTED=$release"
