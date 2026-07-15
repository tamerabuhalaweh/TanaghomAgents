#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test "${TANAGHOM_ROLLBACK_AUTHORIZATION:-}" = 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-BRIDGE' || die 'explicit bridge rollback authorization is absent'

evidence_dir=$(evidence_dir)
release_file="$evidence_dir/release.env"
applied_file="$evidence_dir/applied-migrations"
test -s "$release_file" || die 'bridge evidence is missing'
test -s "$applied_file" || die 'applied-migration evidence is missing'
test ! -e "$evidence_dir/rollback-complete" || die 'this bridge was already rolled back'
test "$(evidence_value "$release_file" EXPECTED_CURRENT_COMMIT)" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" || die 'rollback current-commit authorization mismatch'
test "$(evidence_value "$release_file" TARGET_COMMIT)" = "$TANAGHOM_TARGET_COMMIT" || die 'rollback target authorization mismatch'

assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_dashboard_identity_unchanged "$evidence_dir/dashboard-identity.before"
assert_bridge_default_state

reversed=$(mktemp)
awk '{ lines[NR]=$0 } END { for (i=NR; i>=1; i--) print lines[i] }' "$applied_file" > "$reversed"
while IFS= read -r version; do
  test -n "$version" || continue
  test "$(latest_migration)" = "$version" || die "rollback ledger mismatch before $version"
  db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql"
done < "$reversed"
rm -f "$reversed"

assert_database_at_start
assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_dashboard_identity_unchanged "$evidence_dir/dashboard-identity.before"
assert_firewall_boundary
assert_public_bridge_boundary
printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$evidence_dir/rollback-complete"
chmod 0600 "$evidence_dir/rollback-complete"
echo "PASS: database-only bridge rolled back to $EXPECTED_START_MIGRATION without changing the dashboard."
