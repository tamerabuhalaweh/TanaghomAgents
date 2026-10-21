#!/bin/bash
set -euo pipefail

test "${TANAGHOM_DEMO_DEPLOY_AUTHORIZATION:-}" = "GO-DEPLOY-TANAGHOM-243-DEMO"
test "$(id -u)" = 0
root="${TANAGHOM_DEMO_ROOT:-/opt/tanaghom-demo}"
source_dir="$root/source"
secrets_dir="$root/runtime/secrets"
expected_release="${EXPECTED_DEMO_RELEASE:?exact reviewed demo source revision required}"

test -d "$source_dir"
cd "$source_dir"
test -z "$(git status --porcelain)"
release="$(git rev-parse HEAD)"
test "$release" = "$expected_release"

test "$(df --output=avail -BG / | tail -1 | tr -dc '0-9')" -ge 10
required_secrets="postgres_password api_password database_url supabase_url supabase_publishable_key supabase_jwks_url auth_users.json auth_private_key.pem s3_access_key s3_secret_key"
if [ ! -d "$secrets_dir" ]; then
  if docker volume inspect tanaghom-dashboard-demo-pgdata >/dev/null 2>&1; then
    echo "existing demo database volume has no runtime secrets; restore them or remove disposable demo volumes" >&2
    exit 1
  fi
  bash deployment/dashboard-demo/scripts/prepare-runtime.sh "$secrets_dir"
fi
test -d "$secrets_dir"
chmod 0700 "$secrets_dir"
missing=""
for name in $required_secrets; do
  path="$secrets_dir/$name"
  if [ ! -s "$path" ] || [ -L "$path" ]; then missing="$missing $name"; fi
done
if [ -n "$missing" ]; then
  echo "partial or unsafe demo secrets:$missing; move $secrets_dir aside and reset demo volumes before regenerating" >&2
  exit 1
fi
for name in $required_secrets; do chmod 0444 "$secrets_dir/$name"; done
if [ -e "$secrets_dir/demo-credentials.txt" ]; then chmod 0600 "$secrets_dir/demo-credentials.txt"; fi
export TANAGHOM_DEMO_SECRETS_DIR="$secrets_dir"
export TANAGHOM_DEMO_RELEASE="$release"

compose=(docker compose -p tanaghom-dashboard-demo -f deployment/dashboard-demo/compose.yml)
committed=false
trap 'if ! $committed; then echo "DEMO_DEPLOYMENT_NOT_COMMITTED: services left for inspection; canary untouched" >&2; "${compose[@]}" ps || true; fi' EXIT

"${compose[@]}" config --quiet
"${compose[@]}" config --format json | python3 deployment/dashboard-demo/scripts/validate-compose.py

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
