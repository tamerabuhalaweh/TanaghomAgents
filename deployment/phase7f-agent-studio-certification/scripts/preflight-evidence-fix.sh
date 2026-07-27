#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_certification_environment
for command in git psql docker curl iptables systemctl sha256sum openssl; do
  command -v "$command" >/dev/null 2>&1 ||
    die "required command is missing: $command"
done

test -d "$RELEASE_SOURCE_ROOT/.git" ||
  die 'reviewed Phase 7F release-source checkout is missing'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = \
  "$TANAGHOM_PHASE7F_SOURCE_COMMIT" ||
  die 'release-source checkout is not at the authorized commit'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain)" ||
  die 'release-source checkout is dirty'
test "$(
  git -C "$RELEASE_SOURCE_ROOT" ls-remote origin refs/heads/main | awk '{print $1}'
)" = "$TANAGHOM_PHASE7F_SOURCE_COMMIT" ||
  die 'authorized source is not current remote main'

test -d "$PRODUCTION_ROOT/.git" || die 'Tanaghom production checkout is missing'
test "$(
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD
)" = "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" ||
  die 'production checkout differs from the reviewed baseline'
test -z "$(production_unexpected_changes)" ||
  die 'production checkout contains an unreviewed change'
git -C "$RELEASE_SOURCE_ROOT" merge-base --is-ancestor \
  "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" "$TANAGHOM_PHASE7F_SOURCE_COMMIT" ||
  die 'reviewed source is not a descendant of deployed production'

test "$(latest_migration)" = 0032_gemma_served_model_profile ||
  die 'evidence fix requires exact migration 0032 baseline'
test -s "$RELEASE_SOURCE_ROOT/packages/database/migrations/0033_agent_runtime_certification_evidence.up.sql" ||
  die 'reviewed 0033 up migration is missing'
test -s "$RELEASE_SOURCE_ROOT/packages/database/migrations/0033_agent_runtime_certification_evidence.down.sql" ||
  die 'reviewed 0033 down migration is missing'
test "$(db_scalar "
  SELECT count(*) FROM tanaghom.organization_agent_jobs
   WHERE status IN ('queued','running','waiting_approval');
")" = 0 || die 'shared-runtime work is open'
test "$(db_scalar "
  SELECT count(*) FROM tanaghom.organization_agent_runtime_certifications
   WHERE organization_id='$TANAGHOM_CERTIFICATION_ORGANIZATION_ID'
     AND agent_version_id='$TANAGHOM_CERTIFICATION_AGENT_VERSION_ID';
")" = 0 || die 'a runtime certification already exists'

assert_login_roles_least_privilege
assert_package_credentials_encrypted
assert_shared_credentials
assert_canary_workflows_inactive
assert_canary_credential_bindings
assert_safety_locks
assert_running_gateway_locked
assert_protected_units_active
assert_protected_containers_healthy
assert_dashboard_network_boundary
assert_public_boundary
assert_firewall_boundary

echo 'PASS: migration 0032 is safely ready for the database-only 0033 certification-evidence aggregation fix; no state was changed.'
