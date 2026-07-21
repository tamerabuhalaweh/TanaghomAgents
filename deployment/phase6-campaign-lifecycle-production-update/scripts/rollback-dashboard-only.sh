#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test "${TANAGHOM_ROLLBACK_AUTHORIZATION:-}" = 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-DASHBOARD' || die 'explicit dashboard rollback authorization is absent'

evidence_dir="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
release_file="$evidence_dir/release.env"
test -s "$release_file" || die 'release evidence is missing'
test ! -e "$evidence_dir/dashboard-rollback-complete" || die 'this dashboard rollback was already completed'
grep -q '^COMMITTED_AT=' "$release_file" || die 'the release was not committed'

expected_current=$(evidence_value "$release_file" EXPECTED_CURRENT_COMMIT)
target_commit=$(evidence_value "$release_file" TARGET_COMMIT)
rollback_image=$(evidence_value "$release_file" ROLLBACK_IMAGE)
test "$expected_current" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" || die 'dashboard rollback current-commit authorization mismatch'
test "$target_commit" = "$TANAGHOM_TARGET_COMMIT" || die 'dashboard rollback target authorization mismatch'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$target_commit" || die 'production source is not the recorded target'
assert_production_checkout_at "$target_commit"
assert_preserved_file_unchanged "$evidence_dir/preserved-squid.before.sha256"
test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'campaign lifecycle migration is not current'
docker image inspect "$rollback_image" >/dev/null

assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'all provider emergency stops must be active before dashboard rollback'
test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations exist; dashboard rollback requires separate review'

git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach "$expected_current"
assert_production_checkout_at "$expected_current"
assert_preserved_file_unchanged "$evidence_dir/preserved-squid.before.sha256"
docker image tag "$rollback_image" tanaghom-dashboard-canary:canary
compose up -d --no-deps --force-recreate --no-build dashboard
attempt=0
until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'previous dashboard health timeout'
  sleep 5
done

test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'dashboard rollback changed the database migration'
assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_preserved_file_unchanged "$evidence_dir/preserved-squid.before.sha256"
assert_firewall_boundary
assert_public_boundary
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'restored dashboard is unhealthy'
printf 'DASHBOARD_ROLLED_BACK_AT=%s\nDATABASE_MIGRATION_PRESERVED=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TARGET_MIGRATION" > "$evidence_dir/dashboard-rollback-complete"
chmod 0600 "$evidence_dir/dashboard-rollback-complete"
echo "PASS: Tanaghom dashboard rolled back to $expected_current while migration $TARGET_MIGRATION and campaign data were preserved."
