#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test "${TANAGHOM_PROVIDER_RUNTIME_ROLLBACK:-}" = 'ROLLBACK-PROVEN-PROVIDER-RUNTIME-BOUNDARY' ||
  die 'explicit rollback confirmation is absent'
evidence="/var/backups/tanaghom-$TANAGHOM_PROVIDER_RUNTIME_ID"
test -s "$evidence/release.env" || die 'release evidence is missing'
. "$evidence/release.env"
test "$RELEASE_ID" = "$TANAGHOM_PROVIDER_RUNTIME_ID" || die 'release evidence ID mismatch'
test "$TARGET_COMMIT" = "$TANAGHOM_TARGET_COMMIT" || die 'target evidence mismatch'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TARGET_COMMIT" ||
  die 'production is not at the recorded target'
assert_safety_locks
test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 ||
  die 'rollback refused after provider activity'
assert_n8n_ids_unchanged "$evidence/n8n-container-ids.before"
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach "$PREVIOUS_COMMIT"
docker image tag "$ROLLBACK_IMAGE" tanaghom-dashboard-canary:canary >/dev/null
compose up -d --no-deps --force-recreate --no-build dashboard >/dev/null
attempt=0
until test "$(container_health "$DASHBOARD_CONTAINER")" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'dashboard rollback health timeout'
  sleep 5
done
assert_current_runtime_locked
assert_dashboard_network_boundary
assert_public_boundary
assert_protected_n8n_healthy
assert_n8n_ids_unchanged "$evidence/n8n-container-ids.before"
printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/release.env"
echo 'PASS: only the Tanaghom dashboard runtime-readiness configuration was rolled back.'
