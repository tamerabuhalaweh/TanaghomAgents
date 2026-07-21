#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_environment
evidence="/var/backups/tanaghom-$TANAGHOM_CANARY_ID"
test ! -e "$evidence" || die "evidence path already exists: $evidence"
install -d -m 0700 "$evidence"
prepared=0
restored=0

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$prepared" = 1 && test "$restored" = 0; then
    "$SCRIPT_DIR/restore-workflows.sh" "$evidence" >>"$evidence/automatic-restore.log" 2>&1 || true
  fi
  if test "$status" -ne 0; then
    echo "RESUME_FAILED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$evidence/canary.env"
    echo 'The persisted strategy, campaign, and any content evidence were preserved for human investigation.' >>"$evidence/automatic-restore.log"
  fi
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

"$SCRIPT_DIR/resume-preflight.sh" >"$evidence/preflight.txt"
cat "$evidence/preflight.txt"
operator verify-resume-authorized "$TANAGHOM_CANARY_CAMPAIGN_ID" "$TANAGHOM_CANARY_STRATEGY_JOB_ID" "$TANAGHOM_CANARY_CAMPAIGN" "$TANAGHOM_EXPECTED_CONTENT_ITEMS" >"$evidence/authorized-resume-baseline.json"
capture_container_ids "$evidence/protected-container-ids.before"
iptables-save >"$evidence/iptables.before"; chmod 0600 "$evidence/iptables.before"
normalize_firewall_snapshot "$evidence/iptables.before" "$evidence/iptables.rules.before"
export_all_workflows "$evidence/workflows.before.json"
node "$WORKFLOW_CONTRACT" prepare "$evidence/workflows.before.json" "$RELEASE_SOURCE_ROOT/n8n/workflows/phase3" "$evidence"
prepared=1
strategist_before=$(workflow_execution_count "$STRATEGIST_ID")
producer_before=$(workflow_execution_count "$PRODUCER_ID")
external_before=$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")
posts_before=$(db_scalar "SELECT count(*) FROM tanaghom.posts;")
leads_before=$(db_scalar "SELECT count(*) FROM tanaghom.leads;")
{
  echo "CANARY_ID=$TANAGHOM_CANARY_ID"
  echo "CAMPAIGN_ID=$TANAGHOM_CANARY_CAMPAIGN_ID"
  echo "STRATEGY_JOB_ID=$TANAGHOM_CANARY_STRATEGY_JOB_ID"
  echo "CAMPAIGN=$TANAGHOM_CANARY_CAMPAIGN"
  echo "EXPECTED_CONTENT_ITEMS=$TANAGHOM_EXPECTED_CONTENT_ITEMS"
  echo "PRODUCTION_COMMIT=$TANAGHOM_EXPECTED_PRODUCTION_COMMIT"
  echo "SOURCE_COMMIT=$TANAGHOM_CANARY_SOURCE_COMMIT"
  echo "RESUME_MODE=CONTENT_PRODUCER_ONLY"
  echo "STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "STRATEGIST_EXECUTIONS_BEFORE=$strategist_before"
  echo "PRODUCER_EXECUTIONS_BEFORE=$producer_before"
  echo "EXTERNAL_OPERATIONS_BEFORE=$external_before"
  echo "POSTS_BEFORE=$posts_before"
  echo "LEADS_BEFORE=$leads_before"
} >"$evidence/canary.env"; chmod 0600 "$evidence/canary.env"

import_workflow_inactive "$evidence/$STRATEGIST_ID.canary.json" strategist-contained
import_workflow_inactive "$evidence/$PRODUCER_ID.canary.json" producer-canary
export_all_workflows "$evidence/workflows.canary-inactive.json"
node "$WORKFLOW_CONTRACT" verify "$evidence/workflows.canary-inactive.json" "$evidence/workflow-manifest.json" canary
operator verify-resume-authorized "$TANAGHOM_CANARY_CAMPAIGN_ID" "$TANAGHOM_CANARY_STRATEGY_JOB_ID" "$TANAGHOM_CANARY_CAMPAIGN" "$TANAGHOM_EXPECTED_CONTENT_ITEMS" >/dev/null

operator queue-content "$TANAGHOM_CANARY_CAMPAIGN_ID" "$TANAGHOM_CANARY_STRATEGY_JOB_ID" "$TANAGHOM_CANARY_CAMPAIGN" "$TANAGHOM_EXPECTED_CONTENT_ITEMS" >"$evidence/queue-content.json"
content_job_id=$(jq -er '.content_job_id' "$evidence/queue-content.json")
is_uuid "$content_job_id" || die 'governed content queue returned an invalid job ID'
echo "CONTENT_JOB_ID=$content_job_id" >>"$evidence/canary.env"
set_registry_active_disabled "$PRODUCER_REGISTRY"
publish_workflow "$PRODUCER_ID"
test "$(workflow_active "$PRODUCER_ID")" = 1 || die 'content producer did not enter the active state'
operator verify-content-ready "$TANAGHOM_CANARY_CAMPAIGN_ID" "$TANAGHOM_CANARY_STRATEGY_JOB_ID" "$TANAGHOM_CANARY_CAMPAIGN" "$TANAGHOM_EXPECTED_CONTENT_ITEMS" "$content_job_id" >/dev/null
execute_workflow_once "$PRODUCER_ID" >"$evidence/producer-execution.json"
unpublish_workflow "$PRODUCER_ID"
set_registry_inactive "$PRODUCER_REGISTRY"
assert_workflow_inactive "$PRODUCER_ID"

"$SCRIPT_DIR/restore-workflows.sh" "$evidence" >"$evidence/restore.txt"
cat "$evidence/restore.txt"
restored=1
operator verify-pending "$TANAGHOM_CANARY_CAMPAIGN_ID" "$TANAGHOM_CANARY_STRATEGY_JOB_ID" "$TANAGHOM_CANARY_CAMPAIGN" "$TANAGHOM_EXPECTED_CONTENT_ITEMS" "$content_job_id" >"$evidence/pending-approval.json"
cat "$evidence/pending-approval.json"
export_all_workflows "$evidence/workflows.after.json"
node "$WORKFLOW_CONTRACT" verify "$evidence/workflows.after.json" "$evidence/workflow-manifest.json" original
node "$WORKFLOW_CONTRACT" compare-others "$evidence/workflows.before.json" "$evidence/workflows.after.json"

test "$(workflow_execution_count "$STRATEGIST_ID")" -eq "$strategist_before" || die 'resume unexpectedly executed Campaign Strategist'
test "$(workflow_execution_count "$PRODUCER_ID")" -eq "$((producer_before + 1))" || die 'producer execution delta is not exactly one'
test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = "$external_before" || die 'external operation count changed'
test "$(db_scalar "SELECT count(*) FROM tanaghom.posts;")" = "$posts_before" || die 'post count changed'
test "$(db_scalar "SELECT count(*) FROM tanaghom.leads;")" = "$leads_before" || die 'lead count changed'
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit >"$evidence/n8n-audit.txt"
assert_container_ids_unchanged "$evidence/protected-container-ids.before"
assert_protected_health
assert_public_boundary
assert_firewall_boundary
iptables-save >"$evidence/iptables.after"; chmod 0600 "$evidence/iptables.after"
normalize_firewall_snapshot "$evidence/iptables.after" "$evidence/iptables.rules.after"
cmp -s "$evidence/iptables.rules.before" "$evidence/iptables.rules.after" || die 'host firewall rules changed during the resume'
echo "READY_FOR_HUMAN_APPROVAL_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$evidence/canary.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >"$evidence/SHA256SUMS"
echo 'PASS: Content Producer resumed from the exact persisted strategy and stopped at human approval; Campaign Strategist was not repeated.'
