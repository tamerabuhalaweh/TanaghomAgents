#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/preflight.sh"

evidence_dir="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
rollback_image="tanaghom-dashboard-canary:rollback-$TANAGHOM_RELEASE_ID"
applied_file="$evidence_dir/applied-migrations"
committed=false
source_changed=false
image_saved=false
workflow_remote="/home/node/$WORKFLOW_ID-$TANAGHOM_RELEASE_ID.json"

test ! -e "$evidence_dir" || die 'release evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence_dir"
: > "$applied_file"
chmod 0600 "$applied_file"

rollback_applied_migrations() {
  reversed=$(mktemp)
  awk '{ lines[NR]=$0 } END { for (i=NR; i>=1; i--) print lines[i] }' "$applied_file" > "$reversed"
  while IFS= read -r version; do
    test -n "$version" || continue
    test "$(latest_migration)" = "$version" || { rm -f "$reversed"; return 1; }
    db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql" || { rm -f "$reversed"; return 1; }
  done < "$reversed"
  rm -f "$reversed"
}

automatic_rollback() {
  test "$committed" = false || return 0
  set +e
  rollback_failed=0
  rollback_cleanup_failed=0
  echo 'Release did not commit; restoring the Tanaghom dashboard, new inactive workflow, and package migration.' >&2
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$workflow_remote" >/dev/null 2>&1 || rollback_cleanup_failed=1
  if test "$(workflow_count 2>/dev/null)" = 1; then
    delete_quality_workflow || rollback_failed=1
  fi
  if test "$source_changed" = true; then
    git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach "$TANAGHOM_EXPECTED_CURRENT_COMMIT" >/dev/null 2>&1 || rollback_failed=1
  fi
  if test "$image_saved" = true; then
    docker image tag "$rollback_image" tanaghom-dashboard-canary:canary >/dev/null 2>&1 || rollback_failed=1
    compose up -d --no-deps --force-recreate --no-build dashboard >/dev/null 2>&1 || rollback_failed=1
  fi
  if test "$(latest_migration 2>/dev/null)" = "$TARGET_MIGRATION"; then
    assert_quality_pipeline_safe_to_drop >/dev/null 2>&1 || rollback_failed=1
  fi
  if test "$rollback_failed" -eq 0; then rollback_applied_migrations || rollback_failed=1; fi
  echo "ROLLED_BACK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence_dir/release.env"
  if test "$rollback_cleanup_failed" -ne 0; then
    echo 'ROLLBACK_CLEANUP_FAILED=YES' >> "$evidence_dir/release.env"
    echo 'WARNING: critical rollback completed but package-owned temporary-file cleanup requires review.' >&2
  fi
  if test "$rollback_failed" -ne 0; then
    echo 'ROLLBACK_FAILED=YES' >> "$evidence_dir/release.env"
    echo 'ERROR: automatic rollback was incomplete; keep every emergency stop active.' >&2
  fi
}
trap automatic_rollback EXIT
trap 'exit 70' HUP INT TERM

capture_protected_container_ids "$evidence_dir/n8n-container-ids.before"
capture_firewall_boundary "$evidence_dir/firewall.before"
sha256sum /etc/nginx/conf.d/tanaghom-public.conf > "$evidence_dir/nginx.before.sha256"
export_all_workflows "$evidence_dir/n8n-workflows.before.json"
before_image=$(docker image inspect tanaghom-dashboard-canary:canary --format '{{.Id}}')
cat > "$evidence_dir/release.env" <<EOF
RELEASE_ID=$TANAGHOM_RELEASE_ID
EXPECTED_CURRENT_COMMIT=$TANAGHOM_EXPECTED_CURRENT_COMMIT
TARGET_COMMIT=$TANAGHOM_TARGET_COMMIT
EXPECTED_START_MIGRATION=$EXPECTED_START_MIGRATION
TARGET_MIGRATION=$TARGET_MIGRATION
WORKFLOW_ID=$WORKFLOW_ID
ROLLBACK_IMAGE=$rollback_image
PREVIOUS_IMAGE_ID=$before_image
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 0600 "$evidence_dir"/*
git -C "$RELEASE_SOURCE_ROOT" show --no-patch --format='%H %cI %s' "$TANAGHOM_TARGET_COMMIT" > "$evidence_dir/target-commit.txt"
sha256sum "$WORKFLOW_SOURCE" > "$evidence_dir/workflow-source.sha256"
: > "$evidence_dir/up-migrations.sha256"
: > "$evidence_dir/down-migrations.sha256"
for version in $PENDING_MIGRATIONS; do
  sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.up.sql" >> "$evidence_dir/up-migrations.sha256"
  sha256sum "$RELEASE_SOURCE_ROOT/packages/database/migrations/$version.down.sql" >> "$evidence_dir/down-migrations.sha256"
done
cp "$TANAGHOM_BACKUP_PROOF" "$evidence_dir/offserver-backup-proof.env"
chmod 0600 "$evidence_dir"/*

docker image tag tanaghom-dashboard-canary:canary "$rollback_image"
image_saved=true
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" fetch --no-tags origin main
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse FETCH_HEAD)" = "$TANAGHOM_TARGET_COMMIT" || die 'fetched main does not match the authorized target'
git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" checkout --detach "$TANAGHOM_TARGET_COMMIT"
source_changed=true
test -z "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" status --porcelain)" || die 'target checkout is dirty'
compose config --quiet

expected_previous=$EXPECTED_START_MIGRATION
for version in $PENDING_MIGRATIONS; do
  test "$(latest_migration)" = "$expected_previous" || die "migration predecessor mismatch before $version"
  migration_file="$PRODUCTION_ROOT/packages/database/migrations/$version.up.sql"
  test -s "$migration_file" || die "target migration file is missing: $version"
  db_file "$migration_file"
  echo "$version" >> "$applied_file"
  expected_previous=$version
done
test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'migration target was not reached'

compose build --pull dashboard
compose up -d --no-deps dashboard
attempt=0
until test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 36 || die 'dashboard health timeout'
  sleep 5
done

docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$workflow_remote" >/dev/null 2>&1 || true
docker cp "$WORKFLOW_SOURCE" "$N8N_MAIN_CONTAINER:$workflow_remote" >/dev/null
docker exec -u root "$N8N_MAIN_CONTAINER" test -s "$workflow_remote"
docker exec -u root "$N8N_MAIN_CONTAINER" chmod 0444 "$workflow_remote"
docker exec -u node "$N8N_MAIN_CONTAINER" test -r "$workflow_remote"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$workflow_remote" --activeState=false
docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$workflow_remote"
assert_workflow_inactive
export_all_workflows "$evidence_dir/n8n-workflows.after.json"
assert_existing_workflows_unchanged "$evidence_dir/n8n-workflows.before.json" "$evidence_dir/n8n-workflows.after.json"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit > "$evidence_dir/n8n-audit.txt"
chmod 0600 "$evidence_dir/n8n-audit.txt" "$evidence_dir/n8n-workflows.after.json"

"$SCRIPT_DIR/validate-release.sh"
echo "COMMITTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence_dir/release.env"
committed=true
trap - EXIT HUP INT TERM
echo "PASS: Phase 5G baseline-shadow production update committed. Evidence: $evidence_dir"
