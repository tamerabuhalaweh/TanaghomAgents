#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/preflight.sh"

evidence="/var/backups/tanaghom-$TANAGHOM_PROFILE_RELEASE_ID"
applied=false
committed=false
test ! -e "$evidence" || die "evidence path already exists: $evidence"
install -d -m 0700 "$evidence"

automatic_rollback() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0 && test "$applied" = true && test "$committed" = false; then
    set +e
    if db_file "$MIGRATION_DOWN"; then
      echo "AUTOMATIC_ROLLBACK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        >> "$evidence/release.env"
    else
      echo 'ROLLBACK_FAILED=YES' > "$evidence/ROLLBACK_FAILED"
    fi
    set -e
  fi
  exit "$status"
}
trap automatic_rollback EXIT HUP INT TERM

capture_profile_release_state "$evidence/before"
sha256sum "$MIGRATION_UP" > "$evidence/up.sha256"
sha256sum "$MIGRATION_DOWN" > "$evidence/down.sha256"
git -C "$RELEASE_SOURCE_ROOT" show --no-patch --format='%H %cI %s' \
  "$TANAGHOM_TARGET_COMMIT" > "$evidence/source-commit.txt"
cat > "$evidence/release.env" <<EOF
RELEASE_ID=$TANAGHOM_PROFILE_RELEASE_ID
EXPECTED_CURRENT_COMMIT=$TANAGHOM_EXPECTED_CURRENT_COMMIT
SOURCE_COMMIT=$TANAGHOM_TARGET_COMMIT
EXPECTED_START_MIGRATION=$EXPECTED_START_MIGRATION
TARGET_MIGRATION=$TARGET_MIGRATION
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 0600 "$evidence"/*

db_file "$MIGRATION_UP"
applied=true
assert_profile_target
assert_runtime_quiescent
assert_safety_locks
assert_running_gateway_locked
assert_protected_units_active
assert_protected_containers_healthy
assert_dashboard_network_boundary
assert_public_boundary
assert_firewall_boundary
assert_profile_release_state_unchanged "$evidence/before"

printf 'COMMITTED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >> "$evidence/release.env"
committed=true
trap - EXIT HUP INT TERM
echo "PASS: migration 0032 committed without changing any application, workflow, credential, container, service, firewall or Nginx state. Evidence: $evidence"
