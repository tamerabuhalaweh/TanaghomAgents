#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_canary_environment
evidence="/var/backups/tanaghom-$TANAGHOM_PHASE7F_CANARY_ID"
test ! -e "$evidence" || die "evidence path already exists: $evidence"
install -d -m 0700 "$evidence"
queued=0
completed=0
dispatcher_published=0
dispatcher_corrected=0

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0; then
    set +e
    if test "$queued" = 1 && test -s "$evidence/controls.before.json"; then
      reason=$(jq -er '.reason_base64' "$evidence/controls.before.json" 2>/dev/null)
      operator quarantine "$reason" \
        >> "$evidence/automatic-restore.log" 2>&1
      restore_status=$?
      if test "$restore_status" -ne 0; then
        echo 'AUTOMATIC_RESTORE_FAILED=YES' >> "$evidence/canary.env"
      fi
    fi
    if test "$dispatcher_published" = 1; then
      unpublish_simulation_dispatcher \
        >> "$evidence/automatic-unpublish.log" 2>&1
      unpublish_status=$?
      if test "$unpublish_status" -ne 0; then
        echo 'AUTOMATIC_DISPATCHER_UNPUBLISH_FAILED=YES' \
          >> "$evidence/canary.env"
      elif ! assert_canary_workflows_inactive \
        >> "$evidence/automatic-unpublish.log" 2>&1
      then
        echo 'AUTOMATIC_DISPATCHER_STATE_CHECK_FAILED=YES' \
          >> "$evidence/canary.env"
      fi
    fi
    if test "$dispatcher_corrected" = 1; then
      if import_simulation_dispatcher_inactive \
        "$evidence/dispatcher.before.json" rollback \
        >> "$evidence/automatic-dispatcher-restore.log" 2>&1 &&
        export_all_workflows "$evidence/workflows.restored.json" &&
        node "$SCRIPT_DIR/workflow-contract.mjs" compare-all-operational \
          "$evidence/workflows.before.json" \
          "$evidence/workflows.restored.json" \
          >> "$evidence/automatic-dispatcher-restore.log" 2>&1
      then
        echo 'AUTOMATIC_DISPATCHER_RESTORE=PASS' \
          >> "$evidence/canary.env"
      else
        echo 'AUTOMATIC_DISPATCHER_RESTORE_FAILED=YES' \
          >> "$evidence/canary.env"
      fi
    fi
    echo "CANARY_FAILED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      >> "$evidence/canary.env"
    set -e
  fi
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

"$SCRIPT_DIR/preflight.sh" > "$evidence/preflight.txt"
cat "$evidence/preflight.txt"
operator snapshot-controls > "$evidence/controls.before.json"
reason=$(jq -er '.reason_base64' "$evidence/controls.before.json")
capture_production_state "$evidence/production.before"
capture_side_effect_counts "$evidence/counts.before"
export_all_workflows "$evidence/workflows.before.json"
export_simulation_dispatcher "$evidence/dispatcher.before.json"
node "$SCRIPT_DIR/workflow-contract.mjs" prepare-transition \
  "$evidence/workflows.before.json" \
  "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d" \
  "$evidence" > "$evidence/workflow-transition.before.txt"
{
  echo "CANARY_ID=$TANAGHOM_PHASE7F_CANARY_ID"
  echo "PRODUCTION_COMMIT=$TANAGHOM_EXPECTED_PRODUCTION_COMMIT"
  echo "SOURCE_COMMIT=$TANAGHOM_PHASE7F_SOURCE_COMMIT"
  echo "ORGANIZATION_ID=$TANAGHOM_CANARY_ORGANIZATION_ID"
  echo "OWNER_ID=$TANAGHOM_CANARY_OWNER_ID"
  echo "AGENT_VERSION_ID=$TANAGHOM_CANARY_AGENT_VERSION_ID"
  echo "RUNTIME_PROFILE_ID=$TANAGHOM_CANARY_RUNTIME_PROFILE_ID"
  echo "STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$evidence/canary.env"

dispatcher_state=$(
  jq -er '.dispatcher_state' "$evidence/workflow-transition-manifest.json"
)
if test "$dispatcher_state" = legacy_empty_inputs; then
  dispatcher_corrected=1
  import_simulation_dispatcher_inactive \
    "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d/simulation-dispatcher.v1.json" \
    corrected
elif test "$dispatcher_state" != corrected_passthrough; then
  die "unsupported dispatcher transition state: $dispatcher_state"
fi
export_all_workflows "$evidence/workflows.corrected.json"
node "$SCRIPT_DIR/workflow-contract.mjs" prepare \
  "$evidence/workflows.corrected.json" \
  "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d" \
  "$evidence" > "$evidence/workflow-contract.corrected.txt"
node "$SCRIPT_DIR/workflow-contract.mjs" compare-except-dispatcher \
  "$evidence/workflows.before.json" \
  "$evidence/workflows.corrected.json" \
  > "$evidence/workflow-contract.correction-scope.txt"
echo "DISPATCHER_START_STATE=$dispatcher_state" >> "$evidence/canary.env"
chmod 0600 "$evidence"/*

operator queue > "$evidence/queued-jobs.json"
test "$(jq -r '.jobs | length' "$evidence/queued-jobs.json")" = 2 ||
  die 'the canary did not queue exactly two jobs'
queued=1

for sequence in 1 2; do
  operator assert-exclusive > "$evidence/exclusive-$sequence.json"
  dispatcher_published=1
  publish_simulation_dispatcher > "$evidence/dispatcher-published-$sequence.txt"
  assert_simulation_dispatch_window
  operator unlock > "$evidence/runtime-open-$sequence.json"
  execute_runner_once > "$evidence/n8n-runner-$sequence.json"
  operator lock "$reason" > "$evidence/runtime-restored-$sequence.json"
  unpublish_simulation_dispatcher > "$evidence/dispatcher-unpublished-$sequence.txt"
  dispatcher_published=0
  assert_canary_workflows_inactive
  operator finalize-next > "$evidence/finalized-$sequence.json"
done

operator verify > "$evidence/canary-result.json"
completed=1
capture_side_effect_counts "$evidence/counts.after"
assert_side_effect_counts_unchanged \
  "$evidence/counts.before" "$evidence/counts.after"

export_all_workflows "$evidence/workflows.after.json"
node "$SCRIPT_DIR/workflow-contract.mjs" verify \
  "$evidence/workflows.after.json" \
  "$evidence/workflow-manifest.json" \
  > "$evidence/workflow-contract.after.txt"
node "$SCRIPT_DIR/workflow-contract.mjs" compare-except-dispatcher \
  "$evidence/workflows.before.json" \
  "$evidence/workflows.after.json" \
  > "$evidence/workflow-contract.unchanged.txt"

docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit \
  > "$evidence/n8n-audit.txt"
assert_canary_workflows_inactive
assert_safety_locks
assert_running_gateway_locked
assert_protected_units_active
assert_protected_containers_healthy
assert_dashboard_network_boundary
assert_public_boundary
assert_firewall_boundary
assert_production_state_unchanged "$evidence/production.before"

echo "PASSED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/canary.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 |
  sort -z | xargs -0 sha256sum > "$evidence/SHA256SUMS"
chmod 0600 "$evidence"/*
trap - EXIT HUP INT TERM
echo "PASS: one English and one Arabic Agent Studio scenario passed through the controlled shared runtime with zero external actions. Evidence: $evidence"
