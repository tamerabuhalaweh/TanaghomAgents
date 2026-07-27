#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test "${TANAGHOM_PHASE7D_ROLLBACK_AUTHORIZATION:-}" = \
  'ROLLBACK-LOCKED-PHASE7D-RUNTIME' ||
  die 'explicit Phase 7D rollback authorization is absent'

evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
release_file="$evidence/release.env"
applied_file="$evidence/applied-migrations"
test -s "$release_file" || die 'release evidence is missing'
grep -q '^COMMITTED_AT=' "$release_file" || die 'release never committed'
test ! -e "$evidence/rollback-complete" || die 'release was already rolled back'

evidence_value() {
  sed -n "s/^$2=//p" "$1"
}

expected_current=$(evidence_value "$release_file" EXPECTED_CURRENT_COMMIT)
target_commit=$(evidence_value "$release_file" TARGET_COMMIT)
rollback_image=$(evidence_value "$release_file" ROLLBACK_IMAGE)
test "$expected_current" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" ||
  die 'rollback current-commit authorization mismatch'
test "$target_commit" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'rollback target-commit authorization mismatch'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" \
  rev-parse HEAD)" = "$target_commit" ||
  die 'production source is not the recorded target'
test -z "$(production_unexpected_changes)" ||
  die 'production checkout contains an unreviewed change'
docker image inspect "$rollback_image" >/dev/null
sha256sum -c "$evidence/up-migrations.sha256" >/dev/null ||
  die 'an up migration checksum changed'
sha256sum -c "$evidence/down-migrations.sha256" >/dev/null ||
  die 'a down migration checksum changed'
sha256sum -c "$evidence/workflows.sha256" >/dev/null ||
  die 'a workflow source checksum changed'

assert_target_database
assert_login_roles_least_privilege
assert_package_credentials_encrypted
assert_package_workflows_inactive
assert_safety_locks
test "$(runtime_evidence_count)" = 0 ||
  die 'rollback refuses after Phase 7D runtime evidence exists'
assert_protected_units_active
assert_protected_containers_healthy
assert_n8n_ids_unchanged "$evidence/n8n-container-ids.before"
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null ||
  die 'Nginx configuration changed'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null ||
  die 'reviewed Squid configuration changed'

git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" \
  checkout --detach "$expected_current"
docker image tag "$rollback_image" tanaghom-dashboard-canary:canary
compose up -d --no-deps --force-recreate --no-build dashboard
attempt=0
until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'previous dashboard health timeout'
  sleep 5
done

delete_package_workflows
delete_package_credentials
drop_login_roles

reversed=$(mktemp)
awk '{ lines[NR]=$0 } END { for (i=NR; i>=1; i--) print lines[i] }' \
  "$applied_file" > "$reversed"
while IFS= read -r version; do
  test -n "$version" || continue
  test "$(latest_migration)" = "$version" ||
    die "rollback ledger mismatch before $version"
  db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql"
done < "$reversed"
rm -f "$reversed"

assert_database_at_start
export_all_workflows "$evidence/n8n-workflows.rollback.json"
capture_credential_inventory "$evidence/n8n-credentials.rollback.txt"
assert_existing_workflows_unchanged \
  "$evidence/n8n-workflows.before.json" "$evidence/n8n-workflows.rollback.json"
cmp -s \
  "$evidence/n8n-credentials.before.txt" \
  "$evidence/n8n-credentials.rollback.txt" ||
  die 'n8n credential inventory was not restored'
assert_protected_units_active
assert_protected_containers_healthy
assert_n8n_ids_unchanged "$evidence/n8n-container-ids.before"
assert_dashboard_network_boundary
assert_firewall_boundary
assert_public_boundary
current_firewall=$(mktemp)
capture_firewall_boundary "$current_firewall"
cmp -s "$evidence/firewall.before" "$current_firewall" || {
  rm -f "$current_firewall"
  die 'package-owned firewall state changed during rollback'
}
rm -f "$current_firewall"
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null ||
  die 'Nginx configuration changed during rollback'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null ||
  die 'reviewed Squid configuration changed during rollback'
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit \
  > "$evidence/n8n-audit.rollback.txt"

printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$evidence/rollback-complete"
chmod 0600 "$evidence"/n8n-*.rollback.* "$evidence/rollback-complete"
echo "PASS: Phase 7D transaction rolled back exactly to $EXPECTED_START_MIGRATION and $expected_current."
