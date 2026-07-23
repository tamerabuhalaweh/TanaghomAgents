#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_bilingual_environment
"$SCRIPT_DIR/preflight.sh"

evidence="/var/backups/tanaghom-$TANAGHOM_BILINGUAL_UAT_ID"
committed=false
migration_applied=false
workflow_changed=false
test ! -e "$evidence" || die 'correction evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence"
capture_container_ids "$evidence/n8n-container-ids.before"
capture_production_worktree "$evidence/production-worktree.before"
export_live_strategist "$evidence/strategist.before.json"
sha256sum \
  "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql" \
  "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql" \
  "$STRATEGIST_SOURCE" >"$evidence/reviewed-inputs.sha256"
cat >"$evidence/release.env" <<EOF
UAT_ID=$TANAGHOM_BILINGUAL_UAT_ID
RELEASE_COMMIT=$TANAGHOM_EXPECTED_RELEASE_COMMIT
START_MIGRATION=$EXPECTED_MIGRATION
TARGET_MIGRATION=$TARGET_MIGRATION
GEMMA_PID=$(systemctl show "$GEMMA_UNIT" -p MainPID --value)
GEMMA_STARTED=$(systemctl show "$GEMMA_UNIT" -p ExecMainStartTimestamp --value)
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
find "$evidence" -type f -exec chmod 0600 {} \;

safe_rollback() {
  test "$committed" = false || return 0
  set +e
  failed=0
  if test "$workflow_changed" = true; then
    unpublish_workflow "$STRATEGIST_ID"
    import_strategist_inactive "$evidence/strategist.before.json" rollback || failed=1
    publish_workflow "$STRATEGIST_ID" || failed=1
    restart_n8n_runtime || failed=1
  fi
  if test "$migration_applied" = true &&
     test "$(latest_migration)" = "$TARGET_MIGRATION"
  then
    db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql" ||
      failed=1
  fi
  printf 'SAFE_ROLLBACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    >>"$evidence/release.env"
  if test "$failed" -ne 0; then
    echo 'ROLLBACK_FAILED=YES' >"$evidence/ROLLBACK_FAILED"
  fi
}
trap safe_rollback EXIT
trap 'exit 70' HUP INT TERM

"$SCRIPT_DIR/run-probe.sh" "$evidence"
db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql"
migration_applied=true

workflow_changed=true
unpublish_workflow "$STRATEGIST_ID"
import_strategist_inactive "$STRATEGIST_SOURCE" reviewed
publish_workflow "$STRATEGIST_ID"
restart_marker=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf 'N8N_RESTARTED_AT=%s\n' "$restart_marker" >>"$evidence/release.env"
restart_n8n_runtime
assert_container_ids_unchanged "$evidence/n8n-container-ids.before"
logs=$(docker logs --since "$restart_marker" "$N8N_MAIN_CONTAINER" 2>&1 || true)
if printf '%s\n' "$logs" | grep -E \
  'Activation of workflow "Tanaghom.*did fail|Issue on initial workflow activation try of "Tanaghom'
then
  die 'n8n reported a Tanaghom activation error'
fi

"$SCRIPT_DIR/validate-correction.sh"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit >"$evidence/n8n-audit.txt"
printf 'COMMITTED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >>"$evidence/release.env"
find "$evidence" -type f -exec chmod 0600 {} \;
committed=true
trap - EXIT HUP INT TERM
echo "PASS: bilingual UAT guard correction committed. Evidence: $evidence"
