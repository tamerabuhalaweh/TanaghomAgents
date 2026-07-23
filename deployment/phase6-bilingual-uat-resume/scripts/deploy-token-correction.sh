#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_resume_environment
"$SCRIPT_DIR/preflight.sh"

evidence="/var/backups/tanaghom-$TANAGHOM_BILINGUAL_RESUME_ID"
committed=false
workflow_changed=false
test ! -e "$evidence" || die 'resume evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence"
capture_container_ids "$evidence/n8n-container-ids.before"
capture_production_worktree "$evidence/production-worktree.before"
export_live_strategist "$evidence/strategist.before.json"
sha256sum "$STRATEGIST_SOURCE" >"$evidence/reviewed-inputs.sha256"
cat >"$evidence/release.env" <<EOF
RESUME_ID=$TANAGHOM_BILINGUAL_RESUME_ID
RELEASE_COMMIT=$TANAGHOM_EXPECTED_RELEASE_COMMIT
MIGRATION=$EXPECTED_MIGRATION
ORIGINAL_UAT_ID=$ORIGINAL_UAT_ID
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
  printf 'SAFE_ROLLBACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    >>"$evidence/release.env"
  test "$failed" -eq 0 || echo 'ROLLBACK_FAILED=YES' >"$evidence/ROLLBACK_FAILED"
}
trap safe_rollback EXIT
trap 'exit 70' HUP INT TERM

"$SCRIPT_DIR/run-arabic-probe.sh" "$evidence"
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

"$SCRIPT_DIR/validate-token-correction.sh"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit >"$evidence/n8n-audit.txt"
printf 'COMMITTED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >>"$evidence/release.env"
find "$evidence" -type f -exec chmod 0600 {} \;
committed=true
trap - EXIT HUP INT TERM
echo "PASS: Arabic Strategist correction committed. Evidence: $evidence"
