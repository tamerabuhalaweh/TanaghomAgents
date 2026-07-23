#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/preflight.sh"

evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
rollback_image="tanaghom-dashboard-canary:rollback-$TANAGHOM_RELEASE_ID"
applied_file="$evidence/applied-migrations"
committed=false
source_changed=false
image_saved=false
dashboard_restored=false

test ! -e "$evidence" || die 'release evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence"
: > "$applied_file"
chmod 0600 "$applied_file"

capture_protected_container_ids "$evidence/n8n-container-ids.before"
capture_firewall_boundary "$evidence/firewall.before"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence/nginx.before.sha256"
sha256sum "$ALLOWED_PRODUCTION_FILE" > "$evidence/squid.before.sha256"
before_image=$(docker image inspect tanaghom-dashboard-canary:canary --format '{{.Id}}')
before_container=$(docker inspect tanaghom-dashboard-canary-dashboard-1 --format '{{.Id}}')
cat > "$evidence/release.env" <<EOF
RELEASE_ID=$TANAGHOM_RELEASE_ID
EXPECTED_CURRENT_COMMIT=$TANAGHOM_EXPECTED_CURRENT_COMMIT
TARGET_COMMIT=$TANAGHOM_TARGET_COMMIT
EXPECTED_START_MIGRATION=$EXPECTED_START_MIGRATION
TARGET_MIGRATION=$TARGET_MIGRATION
ROLLBACK_IMAGE=$rollback_image
PREVIOUS_IMAGE_ID=$before_image
PREVIOUS_DASHBOARD_CONTAINER_ID=$before_container
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

: > "$evidence/up-migrations.sha256"
: > "$evidence/down-migrations.sha256"
for version in $PENDING_MIGRATIONS; do
  sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.up.sql" >> "$evidence/up-migrations.sha256"
  sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql" >> "$evidence/down-migrations.sha256"
done
git -C "$RELEASE_SOURCE_ROOT" show --no-patch --format='%H %cI %s' "$TANAGHOM_TARGET_COMMIT" \
  > "$evidence/target-commit.txt"
chmod 0600 "$evidence"/*

rollback_applied_migrations() {
  reversed=$(mktemp)
  awk '{ lines[NR]=$0 } END { for (i=NR; i>=1; i--) print lines[i] }' "$applied_file" > "$reversed"
  while IFS= read -r version; do
    test -n "$version" || continue
    current=$(latest_migration)
    if test "$current" != "$version"; then
      echo "ERROR: automatic rollback ledger mismatch: expected $version, found $current" >&2
      rm -f "$reversed"
      return 1
    fi
    if ! db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql"; then
      echo "ERROR: automatic rollback failed for $version" >&2
      rm -f "$reversed"
      return 1
    fi
  done < "$reversed"
  rm -f "$reversed"
}

restore_dashboard() {
  if test "$source_changed" = true; then
    git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach \
      "$TANAGHOM_EXPECTED_CURRENT_COMMIT" >/dev/null
  fi
  if test "$image_saved" = true; then
    docker image tag "$rollback_image" tanaghom-dashboard-canary:canary >/dev/null
    compose up -d --no-deps --force-recreate --no-build dashboard >/dev/null
    attempt=0
    until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
      attempt=$((attempt + 1))
      test "$attempt" -lt 36 || return 1
      sleep 5
    done
  fi
  dashboard_restored=true
}

automatic_rollback() {
  test "$committed" = false || return 0
  set +e
  rollback_failed=0
  echo 'Release did not commit; restoring only the Tanaghom dashboard and package-applied migrations.' >&2
  restore_dashboard || rollback_failed=1
  if test -s "$applied_file"; then
    if test "$dashboard_restored" != true; then
      rollback_failed=1
    else
      assert_skill_registry_safe_to_drop >/dev/null 2>&1 || rollback_failed=1
      if test "$rollback_failed" -eq 0; then
        rollback_applied_migrations || rollback_failed=1
      fi
    fi
  fi
  printf 'AUTOMATIC_ROLLBACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    >> "$evidence/release.env"
  if test "$rollback_failed" -ne 0; then
    echo 'ROLLBACK_FAILED=YES' > "$evidence/ROLLBACK_FAILED"
    echo 'ERROR: automatic rollback was incomplete; preserve evidence and keep safety controls locked.' >&2
  fi
}

trap automatic_rollback EXIT
trap 'exit 70' HUP INT TERM

docker image tag tanaghom-dashboard-canary:canary "$rollback_image"
image_saved=true
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" fetch --no-tags origin main
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse FETCH_HEAD)" = "$TANAGHOM_TARGET_COMMIT" ||
  die 'fetched production target does not match the authorized commit'
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach \
  "$TANAGHOM_TARGET_COMMIT"
source_changed=true
test -z "$(production_unexpected_changes)" ||
  die 'production checkout contains an unreviewed change after target checkout'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null ||
  die 'the tolerated Squid configuration changed during checkout'

expected_previous=$EXPECTED_START_MIGRATION
for version in $PENDING_MIGRATIONS; do
  test "$(latest_migration)" = "$expected_previous" ||
    die "migration predecessor mismatch before $version"
  db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.up.sql"
  echo "$version" >> "$applied_file"
  expected_previous=$version
done
test "$(latest_migration)" = "$TARGET_MIGRATION" ||
  die 'target migration was not reached'

compose build --pull dashboard
compose up -d --no-deps dashboard
attempt=0
until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'dashboard health timeout'
  sleep 5
done

"$SCRIPT_DIR/validate-release.sh"
printf 'COMMITTED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >> "$evidence/release.env"
chmod 0600 "$evidence/release.env"
committed=true
trap - EXIT HUP INT TERM
echo "PASS: Phase 7A+7B update committed. Evidence: $evidence"
