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
node "$SCRIPT_DIR/workflow-contract.mjs" prepare \
  "$evidence/workflows.before.json" \
  "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d" \
  "$evidence" > "$evidence/workflow-contract.before.txt"
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
chmod 0600 "$evidence"/*

operator queue > "$evidence/queued-jobs.json"
test "$(jq -r '.jobs | length' "$evidence/queued-jobs.json")" = 2 ||
  die 'the canary did not queue exactly two jobs'
queued=1

for sequence in 1 2; do
  operator assert-exclusive > "$evidence/exclusive-$sequence.json"
  operator unlock > "$evidence/runtime-open-$sequence.json"
  execute_runner_once > "$evidence/n8n-runner-$sequence.json"
  operator lock "$reason" > "$evidence/runtime-restored-$sequence.json"
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
node "$SCRIPT_DIR/workflow-contract.mjs" compare-others \
  "$evidence/workflows.before.json" \
  "$evidence/workflows.after.json" \
  > "$evidence/workflow-contract.others.txt"

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
echo "PASS: one English and one Arabic Agent Studio scenario passed through the inactive shared runtime with zero external actions. Evidence: $evidence"
