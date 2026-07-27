#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_release_environment
test "${TANAGHOM_PROFILE_ROLLBACK_AUTHORIZATION:-}" = \
  'ROLLBACK-UNUSED-GEMMA-PROFILE' ||
  die 'explicit served-model profile rollback authorization is absent'

evidence="/var/backups/tanaghom-$TANAGHOM_PROFILE_RELEASE_ID"
test -s "$evidence/release.env" || die 'release evidence is missing'
grep -q '^COMMITTED_AT=' "$evidence/release.env" ||
  die 'served-model profile release never committed'
test ! -e "$evidence/rollback-complete" || die 'release was already rolled back'
sha256sum -c "$evidence/up.sha256" >/dev/null
sha256sum -c "$evidence/down.sha256" >/dev/null
assert_profile_target
assert_runtime_quiescent
test "$(db_scalar "
  SELECT
    (SELECT count(*) FROM tanaghom.organization_agent_jobs
      WHERE runtime_profile_id='$PROFILE_ID')
    +(SELECT count(*) FROM tanaghom.organization_agent_runs
      WHERE runtime_profile_id='$PROFILE_ID')
    +(SELECT count(*) FROM tanaghom.organization_agent_runtime_certifications
      WHERE runtime_profile_id='$PROFILE_ID');
  ")" = 0 || die 'rollback refuses because durable runtime evidence references the profile'
assert_profile_release_state_unchanged "$evidence/before"

db_file "$MIGRATION_DOWN"
assert_profile_absent
assert_runtime_quiescent
assert_safety_locks
assert_protected_units_active
assert_protected_containers_healthy
assert_profile_release_state_unchanged "$evidence/before"
printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$evidence/rollback-complete"
chmod 0600 "$evidence/rollback-complete"
echo "PASS: unused served-model profile rolled back exactly to $EXPECTED_START_MIGRATION."
