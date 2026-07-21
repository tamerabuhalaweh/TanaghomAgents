#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_canary_environment
evidence="/var/backups/tanaghom-$TANAGHOM_CONVERSATION_CANARY_ID"
test ! -e "$evidence" || die "evidence path already exists: $evidence"
install -d -m 0700 "$evidence"
prepared=0
seeded=0
restored=0

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0; then
    set +e
    if test "$prepared" = 1; then
      "$SCRIPT_DIR/restore-locks.sh" "$evidence" >> "$evidence/automatic-restore.log" 2>&1
      restore_status=$?
      if test "$restore_status" -ne 0; then echo 'AUTOMATIC_RESTORE_FAILED=YES' >> "$evidence/canary.env"; fi
    elif test "$seeded" = 1 && test -s "$evidence/controls.before.json"; then
      reason=$(jq -er '.reason_base64' "$evidence/controls.before.json" 2>/dev/null)
      operator quarantine "$TANAGHOM_CONVERSATION_CANARY_ID" "$reason" >> "$evidence/automatic-restore.log" 2>&1 || true
    fi
    echo "CANARY_FAILED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/canary.env"
    set -e
  fi
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

"$SCRIPT_DIR/preflight.sh" > "$evidence/preflight.txt"
cat "$evidence/preflight.txt"
capture_protected_container_ids "$evidence/protected-container-ids.before"
capture_production_worktree_state "$evidence/production-worktree.before"
capture_firewall_boundary "$evidence/firewall.before"
export_all_workflows "$evidence/workflows.before.json"
node "$SCRIPT_DIR/workflow-contract.mjs" prepare "$evidence/workflows.before.json" "$WORKFLOW_SOURCE" "$evidence"
capture_canary_counts "$evidence/counts.before"
operator snapshot-controls "$TANAGHOM_CONVERSATION_CANARY_ID" > "$evidence/controls.before.json"
reason=$(jq -er '.reason_base64' "$evidence/controls.before.json")
prepared=1
{
  echo "CANARY_ID=$TANAGHOM_CONVERSATION_CANARY_ID"
  echo "PRODUCTION_COMMIT=$TANAGHOM_EXPECTED_PRODUCTION_COMMIT"
  echo "SOURCE_COMMIT=$TANAGHOM_CONVERSATION_CANARY_SOURCE_COMMIT"
  echo "STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "WORKFLOW_EXECUTIONS_BEFORE=$(count_value "$evidence/counts.before" workflow_executions)"
} > "$evidence/canary.env"
chmod 0600 "$evidence"/*

operator seed "$TANAGHOM_CONVERSATION_CANARY_ID" > "$evidence/seed.json"
cat "$evidence/seed.json"
seeded=1
operator assert-only-canary "$TANAGHOM_CONVERSATION_CANARY_ID" > "$evidence/exclusive-boundary.json"
operator unlock "$TANAGHOM_CONVERSATION_CANARY_ID" > "$evidence/unlock.json"

publish_workflow
test "$(workflow_active)" = 1 || die 'Conversation Intelligence workflow did not enter the active state'
execute_workflow_once > "$evidence/workflow-execution.json"
unpublish_workflow
import_workflow_inactive "$evidence/$WORKFLOW_ID.original.json" post-execution-restore
operator restore-locks "$TANAGHOM_CONVERSATION_CANARY_ID" "$reason" > "$evidence/restore-locks.json"
restored=1
assert_workflow_inactive

operator verify-ready "$TANAGHOM_CONVERSATION_CANARY_ID" > "$evidence/proposal-ready.json"
cat "$evidence/proposal-ready.json"
operator finalize "$TANAGHOM_CONVERSATION_CANARY_ID" > "$evidence/finalize.json"
operator verify-finalized "$TANAGHOM_CONVERSATION_CANARY_ID" > "$evidence/finalized-state.json"
operator snapshot-controls "$TANAGHOM_CONVERSATION_CANARY_ID" > "$evidence/controls.after.json"
test "$(jq -r '.reason_base64' "$evidence/controls.before.json")" = "$(jq -r '.reason_base64' "$evidence/controls.after.json")" || die 'the original GHL emergency-stop reason was not restored'

export_all_workflows "$evidence/workflows.after.json"
node "$SCRIPT_DIR/workflow-contract.mjs" verify "$evidence/workflows.after.json" "$evidence/workflow-manifest.json"
node "$SCRIPT_DIR/workflow-contract.mjs" compare-others "$evidence/workflows.before.json" "$evidence/workflows.after.json"
capture_canary_counts "$evidence/counts.after"
assert_counts_unchanged_except_execution "$evidence/counts.before" "$evidence/counts.after"

docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit > "$evidence/n8n-audit.txt"
assert_protected_container_ids_unchanged "$evidence/protected-container-ids.before"
assert_production_worktree_unchanged "$evidence/production-worktree.before"
assert_protected_units_active
assert_protected_containers_healthy
assert_public_boundary
assert_firewall_boundary
capture_firewall_boundary "$evidence/firewall.after"
cmp -s "$evidence/firewall.before" "$evidence/firewall.after" || die 'host firewall policy changed during the canary'

echo "PASSED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/canary.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > "$evidence/SHA256SUMS"
trap - EXIT HUP INT TERM
echo "PASS: Conversation Intelligence produced one grounded Supervisor Inbox proposal with zero external actions. Evidence: $evidence"
