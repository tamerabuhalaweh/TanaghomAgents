#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_environment
umask 077
test "${TANAGHOM_JOB_RECONCILIATION_EXECUTE:-}" = 'YES-COMPLETE-THE-REVIEWED-CONTENT-JOB' || die 'separate content-job reconciliation authorization is absent'
evidence="/var/backups/tanaghom-$TANAGHOM_JOB_RECONCILIATION_ID"
test ! -e "$evidence" || die "evidence path already exists: $evidence"
install -d -m 0700 "$evidence"

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0; then
    operator snapshot >"$evidence/failure-state.json" 2>"$evidence/failure-state.error" || true
    echo "RECONCILIATION_FAILED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$evidence/reconciliation.env"
  fi
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

"$SCRIPT_DIR/preflight.sh" >"$evidence/preflight.txt"
cat "$evidence/preflight.txt"
capture_container_ids "$evidence/protected-container-ids.before"
iptables-save >"$evidence/iptables.before"; chmod 0600 "$evidence/iptables.before"
normalize_firewall_snapshot "$evidence/iptables.before" "$evidence/iptables.rules.before"
export_all_workflows "$evidence/workflows.before.json"
node "$CORE_CANARY_PACKAGE/scripts/workflow-contract.mjs" verify "$evidence/workflows.before.json" "$CANARY_EVIDENCE/workflow-manifest.json" original
operator preflight >"$evidence/job.before.json"

strategist_executions=$(workflow_execution_count "$STRATEGIST_ID")
producer_executions=$(workflow_execution_count "$PRODUCER_ID")
{
  echo "RECONCILIATION_ID=$TANAGHOM_JOB_RECONCILIATION_ID"
  echo "CANARY_ID=$TANAGHOM_CANARY_ID"
  echo "CAMPAIGN=$TANAGHOM_CANARY_CAMPAIGN"
  echo "CONTENT_JOB_ID=$TANAGHOM_CONTENT_JOB_ID"
  echo "PRODUCTION_COMMIT=$TANAGHOM_EXPECTED_PRODUCTION_COMMIT"
  echo "SOURCE_COMMIT=$TANAGHOM_RECONCILIATION_SOURCE_COMMIT"
  echo "CANARY_SOURCE_COMMIT=$TANAGHOM_CANARY_SOURCE_COMMIT"
  echo "STRATEGIST_EXECUTIONS_BEFORE=$strategist_executions"
  echo "PRODUCER_EXECUTIONS_BEFORE=$producer_executions"
  echo "STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$evidence/reconciliation.env"; chmod 0600 "$evidence/reconciliation.env"

operator reconcile >"$evidence/completion.json"
cat "$evidence/completion.json"
operator verify-complete >"$evidence/job.after.json"
export_all_workflows "$evidence/workflows.after.json"
node "$CORE_CANARY_PACKAGE/scripts/workflow-contract.mjs" verify "$evidence/workflows.after.json" "$CANARY_EVIDENCE/workflow-manifest.json" original
node "$CORE_CANARY_PACKAGE/scripts/workflow-contract.mjs" compare-others "$evidence/workflows.before.json" "$evidence/workflows.after.json"
test "$(workflow_execution_count "$STRATEGIST_ID")" = "$strategist_executions" || die 'strategist execution count changed'
test "$(workflow_execution_count "$PRODUCER_ID")" = "$producer_executions" || die 'content-producer execution count changed'
assert_workflow_inactive "$STRATEGIST_ID"
assert_workflow_inactive "$PRODUCER_ID"
assert_container_ids_unchanged "$evidence/protected-container-ids.before"
assert_protected_health
assert_public_boundary
assert_firewall_boundary
iptables-save >"$evidence/iptables.after"; chmod 0600 "$evidence/iptables.after"
normalize_firewall_snapshot "$evidence/iptables.after" "$evidence/iptables.rules.after"
cmp -s "$evidence/iptables.rules.before" "$evidence/iptables.rules.after" || die 'host firewall rules changed during reconciliation'
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit >"$evidence/n8n-audit.txt"
echo "RECONCILIATION_SUCCEEDED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$evidence/reconciliation.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >"$evidence/SHA256SUMS"
echo 'PASS: the reviewed content job is succeeded with one immutable completion audit; no workflow or provider action occurred.'
