#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test "${TANAGHOM_ROLLBACK_AUTHORIZATION:-}" = 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-SHADOW-RELEASE' || die 'explicit shadow-release rollback authorization is absent'

evidence_dir="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
release_file="$evidence_dir/release.env"
applied_file="$evidence_dir/applied-migrations"
test -s "$release_file" || die 'release evidence is missing'
test -s "$applied_file" || die 'applied-migration evidence is missing'
test -s "$evidence_dir/n8n-workflows.before.json" || die 'pre-import workflow evidence is missing'
test ! -e "$evidence_dir/rollback-complete" || die 'this transaction was already rolled back'

expected_current=$(evidence_value "$release_file" EXPECTED_CURRENT_COMMIT)
target_commit=$(evidence_value "$release_file" TARGET_COMMIT)
rollback_image=$(evidence_value "$release_file" ROLLBACK_IMAGE)
test "$expected_current" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" || die 'rollback current-commit authorization mismatch'
test "$target_commit" = "$TANAGHOM_TARGET_COMMIT" || die 'rollback target authorization mismatch'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$target_commit" || die 'production source is not recorded target'
docker image inspect "$rollback_image" >/dev/null

assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'all provider emergency stops must be active before rollback'
test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations exist; schema rollback is unsafe'
assert_quality_pipeline_safe_to_drop
assert_workflow_inactive

delete_quality_workflow
workflow_after_delete="$evidence_dir/n8n-workflows.rollback.json"
export_all_workflows "$workflow_after_delete"
assert_existing_workflows_unchanged "$evidence_dir/n8n-workflows.before.json" "$workflow_after_delete"

git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach "$expected_current"
docker image tag "$rollback_image" tanaghom-dashboard-canary:canary
compose up -d --no-deps --force-recreate --no-build dashboard
attempt=0
until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'previous dashboard health timeout'
  sleep 5
done

reversed=$(mktemp)
awk '{ lines[NR]=$0 } END { for (i=NR; i>=1; i--) print lines[i] }' "$applied_file" > "$reversed"
while IFS= read -r version; do
  test -n "$version" || continue
  test "$(latest_migration)" = "$version" || die "rollback ledger mismatch before $version"
  db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql"
done < "$reversed"
rm -f "$reversed"

assert_database_at_start
assert_workflow_absent
assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_firewall_boundary
assert_public_boundary
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'restored dashboard is unhealthy'
printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$evidence_dir/rollback-complete"
chmod 0600 "$evidence_dir/rollback-complete" "$workflow_after_delete"
echo "PASS: Phase 5G shadow release rolled back to $EXPECTED_START_MIGRATION with the new workflow removed."
