#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_certification_environment
evidence="/var/backups/tanaghom-$TANAGHOM_PHASE7F_CERTIFICATION_ID"
test ! -e "$evidence" || die "evidence path already exists: $evidence"
install -d -m 0700 "$evidence"
queued=0
dispatcher_published=0

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0; then
    set +e
    if test "$queued" = 1 && test -s "$evidence/controls.before.json"; then
      reason=$(jq -er '.reason_base64' "$evidence/controls.before.json" 2>/dev/null)
      operator quarantine "$reason" \
        >> "$evidence/automatic-quarantine.log" 2>&1
      restore_status=$?
      if test "$restore_status" -ne 0; then
        echo 'AUTOMATIC_QUARANTINE_FAILED=YES' >> "$evidence/certification.env"
      fi
    fi
    if test "$dispatcher_published" = 1; then
      unpublish_simulation_dispatcher \
        >> "$evidence/automatic-unpublish.log" 2>&1
      unpublish_status=$?
      if test "$unpublish_status" -ne 0; then
        echo 'AUTOMATIC_DISPATCHER_UNPUBLISH_FAILED=YES' \
          >> "$evidence/certification.env"
      fi
    fi
    echo "CERTIFICATION_FAILED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      >> "$evidence/certification.env"
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
node "$WORKFLOW_CONTRACT" prepare \
  "$evidence/workflows.before.json" \
  "$RELEASE_SOURCE_ROOT/n8n/workflows/phase7d" \
  "$evidence" > "$evidence/workflow-contract.before.txt"
{
  echo "CERTIFICATION_ID=$TANAGHOM_PHASE7F_CERTIFICATION_ID"
  echo "PRODUCTION_COMMIT=$TANAGHOM_EXPECTED_PRODUCTION_COMMIT"
  echo "SOURCE_COMMIT=$TANAGHOM_PHASE7F_SOURCE_COMMIT"
  echo "ORGANIZATION_ID=$TANAGHOM_CERTIFICATION_ORGANIZATION_ID"
  echo "OWNER_ID=$TANAGHOM_CERTIFICATION_OWNER_ID"
  echo "AGENT_VERSION_ID=$TANAGHOM_CERTIFICATION_AGENT_VERSION_ID"
  echo "RUNTIME_PROFILE_ID=$TANAGHOM_CERTIFICATION_RUNTIME_PROFILE_ID"
  echo "STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$evidence/certification.env"
chmod 0600 "$evidence"/*

operator queue > "$evidence/queued-jobs.json"
job_count=$(jq -er '.jobs | length' "$evidence/queued-jobs.json")
model_count=$(jq -er '.model_jobs' "$evidence/queued-jobs.json")
direct_count=$(jq -er '.direct_jobs' "$evidence/queued-jobs.json")
test "$job_count" -ge 1 && test "$job_count" -le 12 ||
  die 'certification did not queue between one and twelve missing scenarios'
test "$((model_count + direct_count))" = "$job_count" ||
  die 'certification execution-path counts do not match queued scenarios'
queued=1

sequence=1
while test "$sequence" -le "$model_count"; do
  operator assert-exclusive > "$evidence/model-exclusive-$sequence.json"
  dispatcher_published=1
  publish_simulation_dispatcher > "$evidence/dispatcher-published-$sequence.txt"
  assert_simulation_dispatch_window
  operator unlock > "$evidence/runtime-open-$sequence.json"
  execute_runner_once > "$evidence/n8n-model-runner-$sequence.json"
  operator lock "$reason" > "$evidence/runtime-restored-$sequence.json"
  unpublish_simulation_dispatcher > "$evidence/dispatcher-unpublished-$sequence.txt"
  dispatcher_published=0
  assert_canary_workflows_inactive
  operator finalize-model-next > "$evidence/model-finalized-$sequence.json"
  sequence=$((sequence + 1))
done

sequence=1
while test "$sequence" -le "$direct_count"; do
  operator assert-exclusive > "$evidence/direct-exclusive-$sequence.json"
  operator run-direct-next "$reason" > "$evidence/direct-finalized-$sequence.json"
  sequence=$((sequence + 1))
done

operator certify > "$evidence/certification-record.json"
operator verify > "$evidence/certification-result.json"
capture_side_effect_counts "$evidence/counts.after"
assert_side_effect_counts_unchanged \
  "$evidence/counts.before" "$evidence/counts.after"

export_all_workflows "$evidence/workflows.after.json"
node "$WORKFLOW_CONTRACT" verify \
  "$evidence/workflows.after.json" \
  "$evidence/workflow-manifest.json" \
  > "$evidence/workflow-contract.after.txt"
node "$WORKFLOW_CONTRACT" compare-all-operational \
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

echo "PASSED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/certification.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 |
  sort -z | xargs -0 sha256sum > "$evidence/SHA256SUMS"
chmod 0600 "$evidence"/*
trap - EXIT HUP INT TERM
echo "PASS: all fourteen English/Arabic Agent Studio scenarios are certified with zero external actions. Evidence: $evidence"
