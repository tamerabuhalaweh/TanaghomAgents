#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test "${TANAGHOM_RESUME_AUTHORIZATION:-}" = 'RESUME-THE-REVIEWED-TANAGHOM-RELEASE' || die 'explicit recovery authorization is absent'
case "${TANAGHOM_RESUME_SOURCE_RELEASE_ID:-}" in
  phase6-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
  *) die 'TANAGHOM_RESUME_SOURCE_RELEASE_ID must use phase6-YYYYMMDDTHHMMSSZ' ;;
esac
test "${TANAGHOM_BACKUP_RELEASE_ID:-}" = "$TANAGHOM_RESUME_SOURCE_RELEASE_ID" || die 'resume backup release identity does not match the interrupted release'
validate_backup_proof

prior_evidence="/var/backups/tanaghom-$TANAGHOM_RESUME_SOURCE_RELEASE_ID"
prior_release="$prior_evidence/release.env"
test -s "$prior_release" || die 'interrupted release evidence is missing'
test -s "$prior_evidence/campaign-lifecycle.before.md5" || die 'interrupted release campaign baseline is missing'
test -s "$prior_evidence/up-migrations.sha256" || die 'interrupted release migration evidence is missing'
! grep -q '^COMMITTED_AT=' "$prior_release" || die 'the source release already committed and cannot be resumed'
test "$(evidence_value "$prior_release" EXPECTED_CURRENT_COMMIT)" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" || die 'interrupted release current commit differs from this recovery authorization'
test "$(evidence_value "$prior_release" TARGET_MIGRATION)" = "$TARGET_MIGRATION" || die 'interrupted release target migration differs from this recovery package'
prior_migration_hash=$(awk '$2 ~ /0023_campaign_lifecycle\.up\.sql$/ { print $1; found=1 } END { if (!found) exit 1 }' "$prior_evidence/up-migrations.sha256")
current_migration_hash=$(sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql" | awk '{print $1}')
test "$current_migration_hash" = "$prior_migration_hash" || die 'reviewed migration differs from the one already applied'

test -d "$RELEASE_SOURCE_ROOT/.git" || die 'reviewed release-source checkout is missing'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain)" || die 'release-source checkout is dirty'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" || die 'release-source checkout is not the authorized target'
test -d "$PRODUCTION_ROOT/.git" || die 'production Git checkout is missing'
assert_production_checkout_at "$TANAGHOM_EXPECTED_CURRENT_COMMIT"
assert_preserved_path_stable
remote_target=$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" ls-remote origin refs/heads/main | awk '{print $1}')
test "$remote_target" = "$TANAGHOM_TARGET_COMMIT" || die 'target commit is not the current remote main commit'

available_gib=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
test "$available_gib" -ge 20 || die 'less than 20 GiB is available on the root filesystem'
test -s /var/lib/tanaghom-public/deployed || die 'public deployment marker is missing'

assert_secret_metadata
docker info >/dev/null
compose config --quiet
assert_protected_units_active
assert_protected_containers_healthy
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'dashboard container is not healthy'
test "$(docker inspect -f '{{.Image}}' tanaghom-dashboard-canary-dashboard-1)" = "$(evidence_value "$prior_release" PREVIOUS_IMAGE_ID)" || die 'running dashboard is not the pre-release image restored after interruption'
assert_firewall_boundary
assert_database_at_target
assert_agent_registry_contract
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='active';")" = 0 || die 'a workflow is unexpectedly active'
assert_campaign_lifecycle_unchanged "$prior_evidence/campaign-lifecycle.before.md5"
assert_public_boundary

echo "PASS: interrupted Phase 6 release is stable at migration $TARGET_MIGRATION and safe for dashboard-only completion."
