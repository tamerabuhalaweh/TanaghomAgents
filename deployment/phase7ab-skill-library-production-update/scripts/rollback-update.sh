#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test "${TANAGHOM_ROLLBACK_AUTHORIZATION:-}" = 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE' ||
  die 'explicit rollback authorization is absent'

evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
release_file="$evidence/release.env"
applied_file="$evidence/applied-migrations"
test -s "$release_file" || die 'committed release evidence is missing'
grep -q '^COMMITTED_AT=' "$release_file" || die 'release did not reach committed state'
test -s "$applied_file" || die 'applied-migration evidence is missing'
test ! -e "$evidence/rollback-complete" || die 'this release was already rolled back'

expected_current=$(evidence_value "$release_file" EXPECTED_CURRENT_COMMIT)
target_commit=$(evidence_value "$release_file" TARGET_COMMIT)
rollback_image=$(evidence_value "$release_file" ROLLBACK_IMAGE)
test "$expected_current" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" ||
  die 'rollback current-commit authorization mismatch'
test "$target_commit" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'rollback target-commit authorization mismatch'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$target_commit" ||
  die 'production source is not the recorded target'
test -z "$(production_unexpected_changes)" ||
  die 'production checkout contains an unreviewed change'
docker image inspect "$rollback_image" >/dev/null
sha256sum -c "$evidence/up-migrations.sha256" >/dev/null ||
  die 'an up migration checksum changed'
sha256sum -c "$evidence/down-migrations.sha256" >/dev/null ||
  die 'a down migration checksum changed'

assert_policy_locked
assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence/n8n-container-ids.before"
assert_skill_library_target
assert_skill_registry_safe_to_drop
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null ||
  die 'Nginx configuration changed'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null ||
  die 'the tolerated Squid configuration changed'

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
  test "$(latest_migration)" = "$version" ||
    die "rollback ledger mismatch before $version"
  db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql"
done < "$reversed"
rm -f "$reversed"

assert_database_at_start
assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence/n8n-container-ids.before"
current_firewall=$(mktemp)
capture_firewall_boundary "$current_firewall"
cmp -s "$evidence/firewall.before" "$current_firewall" ||
  die 'package-owned firewall state changed'
rm -f "$current_firewall"
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null ||
  die 'Nginx configuration changed'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null ||
  die 'the tolerated Squid configuration changed'
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy ||
  die 'restored dashboard is unhealthy'
assert_firewall_boundary
assert_public_preupdate_boundary

printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$evidence/rollback-complete"
chmod 0600 "$evidence/rollback-complete"
echo "PASS: Phase 7A+7B transaction rolled back to $EXPECTED_START_MIGRATION and $expected_current."
