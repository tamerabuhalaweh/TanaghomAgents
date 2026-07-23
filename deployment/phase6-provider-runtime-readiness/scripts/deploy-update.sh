#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/preflight.sh"

evidence="/var/backups/tanaghom-$TANAGHOM_PROVIDER_RUNTIME_ID"
rollback_image="tanaghom-dashboard-canary:rollback-$TANAGHOM_PROVIDER_RUNTIME_ID"
test ! -e "$evidence" || die 'release evidence already exists'
install -d -o root -g root -m 0700 "$evidence"
capture_n8n_ids "$evidence/n8n-container-ids.before"
capture_firewall "$evidence/firewall.before"
container_env | grep -E '^(POSTIZ_AUTOMATION_RUNTIME_READY|GHL_ACTION_RUNTIME_READY|GHL_ACTION_RUNTIME_ENABLED|GHL_CONTACT_SYNC_ENABLED|GHL_WEBHOOK_INGRESS_ENABLED|TANAGHOM_INTEGRATION_GATEWAY_URL)=' \
  > "$evidence/dashboard-env.before"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence/nginx.before.sha256"
sha256sum "$ALLOWED_PRODUCTION_FILE" > "$evidence/squid.before.sha256"
before_image=$(docker image inspect tanaghom-dashboard-canary:canary --format '{{.Id}}')
before_container=$(docker inspect "$DASHBOARD_CONTAINER" --format '{{.Id}}')
cat > "$evidence/release.env" <<EOF
RELEASE_ID=$TANAGHOM_PROVIDER_RUNTIME_ID
PREVIOUS_COMMIT=$TANAGHOM_EXPECTED_CURRENT_COMMIT
TARGET_COMMIT=$TANAGHOM_TARGET_COMMIT
ROLLBACK_IMAGE=$rollback_image
PREVIOUS_IMAGE_ID=$before_image
PREVIOUS_DASHBOARD_CONTAINER_ID=$before_container
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 0600 "$evidence"/*

committed=false
source_changed=false
image_saved=false
automatic_rollback() {
  test "$committed" = false || return 0
  set +e
  echo 'Release did not commit; restoring only the Tanaghom dashboard.' >&2
  if test "$source_changed" = true; then
    git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach "$TANAGHOM_EXPECTED_CURRENT_COMMIT" >/dev/null
  fi
  if test "$image_saved" = true; then
    docker image tag "$rollback_image" tanaghom-dashboard-canary:canary >/dev/null
    compose up -d --no-deps --force-recreate --no-build dashboard >/dev/null
  fi
  printf 'AUTOMATIC_ROLLBACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/release.env"
}
trap automatic_rollback EXIT
trap 'exit 70' HUP INT TERM

docker image tag tanaghom-dashboard-canary:canary "$rollback_image"
image_saved=true
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" fetch --no-tags origin main
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse FETCH_HEAD)" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'fetched target differs from authorization'
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach "$TANAGHOM_TARGET_COMMIT"
source_changed=true
test -z "$(production_unexpected_changes)" || die 'production checkout is dirty after target checkout'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null || die 'Squid configuration changed'
compose build --pull dashboard
compose up -d --no-deps dashboard
attempt=0
until test "$(container_health "$DASHBOARD_CONTAINER")" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'dashboard health timeout'
  sleep 5
done
"$SCRIPT_DIR/validate-release.sh"
printf 'COMMITTED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/release.env"
chmod 0600 "$evidence/release.env"
committed=true
trap - EXIT HUP INT TERM
echo "PASS: provider runtime readiness committed. Evidence: $evidence"
