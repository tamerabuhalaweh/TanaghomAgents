#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/resume-preflight.sh"

evidence_dir="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
rollback_image="tanaghom-dashboard-canary:rollback-$TANAGHOM_RELEASE_ID"
committed=false
source_changed=false
image_saved=false

test ! -e "$evidence_dir" || die 'release evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence_dir"
capture_protected_container_ids "$evidence_dir/n8n-container-ids.before"
capture_firewall_boundary "$evidence_dir/firewall.before"
capture_preserved_file_checksum "$evidence_dir/preserved-squid.before.sha256"
capture_agent_registry_fingerprint "$evidence_dir/agent-registry.before.md5"
campaign_lifecycle_fingerprint > "$evidence_dir/campaign-lifecycle.before.md5"
chmod 0600 "$evidence_dir/campaign-lifecycle.before.md5"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence_dir/nginx.before.sha256"
chmod 0600 "$evidence_dir/nginx.before.sha256"
before_image=$(docker image inspect tanaghom-dashboard-canary:canary --format '{{.Id}}')
cat > "$evidence_dir/release.env" <<EOF
RELEASE_ID=$TANAGHOM_RELEASE_ID
RESUMED_FROM_RELEASE_ID=$TANAGHOM_RESUME_SOURCE_RELEASE_ID
EXPECTED_CURRENT_COMMIT=$TANAGHOM_EXPECTED_CURRENT_COMMIT
TARGET_COMMIT=$TANAGHOM_TARGET_COMMIT
EXPECTED_START_MIGRATION=$TARGET_MIGRATION
TARGET_MIGRATION=$TARGET_MIGRATION
ROLLBACK_IMAGE=$rollback_image
PREVIOUS_IMAGE_ID=$before_image
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 0600 "$evidence_dir/release.env"
git -C "$RELEASE_SOURCE_ROOT" show --no-patch --format='%H %cI %s' "$TANAGHOM_TARGET_COMMIT" > "$evidence_dir/target-commit.txt"
sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql" > "$evidence_dir/already-applied-migration.sha256"
cp "$TANAGHOM_BACKUP_PROOF" "$evidence_dir/offserver-backup-proof.env"
chmod 0600 "$evidence_dir/target-commit.txt" "$evidence_dir/already-applied-migration.sha256" "$evidence_dir/offserver-backup-proof.env"

automatic_resume_rollback() {
  test "$committed" = false || return 0
  set +e
  rollback_failed=0
  echo 'Resume did not commit; restoring only the previous Tanaghom dashboard source and image.' >&2
  if test "$source_changed" = true; then
    git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach "$TANAGHOM_EXPECTED_CURRENT_COMMIT" >/dev/null 2>&1 || rollback_failed=1
    ( assert_production_checkout_at "$TANAGHOM_EXPECTED_CURRENT_COMMIT" ) >/dev/null 2>&1 || rollback_failed=1
  fi
  if test "$image_saved" = true; then
    docker image tag "$rollback_image" tanaghom-dashboard-canary:canary >/dev/null 2>&1 || rollback_failed=1
    compose up -d --no-deps --force-recreate --no-build dashboard >/dev/null 2>&1 || rollback_failed=1
  fi
  ( assert_agent_registry_unchanged "$evidence_dir/agent-registry.before.md5" ) >/dev/null 2>&1 || rollback_failed=1
  ( assert_campaign_lifecycle_unchanged "$evidence_dir/campaign-lifecycle.before.md5" ) >/dev/null 2>&1 || rollback_failed=1
  ( assert_preserved_file_unchanged "$evidence_dir/preserved-squid.before.sha256" ) >/dev/null 2>&1 || rollback_failed=1
  echo "RESUME_ROLLED_BACK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence_dir/release.env"
  if test "$rollback_failed" -ne 0; then
    echo 'ROLLBACK_FAILED=YES' >> "$evidence_dir/release.env"
    echo 'ERROR: automatic resume rollback was incomplete; keep every emergency stop active and follow the recovery runbook.' >&2
  fi
}
trap automatic_resume_rollback EXIT
trap 'exit 70' HUP INT TERM

docker image tag tanaghom-dashboard-canary:canary "$rollback_image"
image_saved=true

git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" fetch --no-tags origin main
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse FETCH_HEAD)" = "$TANAGHOM_TARGET_COMMIT" || die 'fetched main does not match the authorized target'
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach "$TANAGHOM_TARGET_COMMIT"
source_changed=true
assert_production_checkout_at "$TANAGHOM_TARGET_COMMIT"
assert_preserved_file_unchanged "$evidence_dir/preserved-squid.before.sha256"
compose config --quiet
test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'resume must not change the migration ledger'

compose build --pull dashboard
compose up -d --no-deps dashboard
attempt=0
until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'dashboard health timeout'
  sleep 5
done

"$SCRIPT_DIR/validate-release.sh"
echo "COMMITTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence_dir/release.env"
committed=true
trap - EXIT HUP INT TERM
echo "PASS: Phase 6 Campaign Lifecycle dashboard-only completion committed. Evidence: $evidence_dir"
