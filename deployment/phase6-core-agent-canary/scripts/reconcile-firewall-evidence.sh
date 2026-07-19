#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_environment
test "${TANAGHOM_FIREWALL_EVIDENCE_RECONCILIATION:-}" = 'YES-RECONCILE-VOLATILE-FIREWALL-EVIDENCE' || die 'separate firewall-evidence reconciliation authorization is absent'
evidence=${1:-/var/backups/tanaghom-$TANAGHOM_CANARY_ID}
test -d "$evidence" || die 'canary evidence directory is missing'
test -s "$evidence/canary.env" || die 'canary environment evidence is missing'
test -s "$evidence/iptables.before" || die 'before-firewall evidence is missing'
test -s "$evidence/iptables.after" || die 'after-firewall evidence is missing'
test -s "$evidence/workflows.before.json" || die 'before-workflow evidence is missing'
test -s "$evidence/workflow-manifest.json" || die 'workflow manifest evidence is missing'
test -s "$evidence/pending-approval.json" || die 'pending-approval evidence is missing'
test -s "$evidence/n8n-audit.txt" || die 'n8n audit evidence is missing'
grep -q '^CANARY_FAILED_AT=' "$evidence/canary.env" || die 'evidence is not from the known final-gate false negative'
if grep -q '^READY_FOR_HUMAN_APPROVAL_AT=' "$evidence/canary.env"; then
  die 'canary evidence is already ready for human approval'
fi
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM

evidence_value() { sed -n "s/^$1=//p" "$evidence/canary.env"; }
test "$(evidence_value CANARY_ID)" = "$TANAGHOM_CANARY_ID" || die 'canary ID evidence mismatch'
test "$(evidence_value CAMPAIGN)" = "$TANAGHOM_CANARY_CAMPAIGN" || die 'campaign evidence mismatch'
test "$(evidence_value PRODUCTION_COMMIT)" = "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" || die 'production commit evidence mismatch'
test "$(evidence_value SOURCE_COMMIT)" = "$TANAGHOM_CANARY_SOURCE_COMMIT" || die 'source commit evidence mismatch'

normalize_firewall_snapshot "$evidence/iptables.before" "$temporary/iptables.rules.before"
normalize_firewall_snapshot "$evidence/iptables.after" "$temporary/iptables.rules.after"
cmp -s "$temporary/iptables.rules.before" "$temporary/iptables.rules.after" || die 'firewall rules differed during the canary'
iptables-save >"$temporary/iptables.reconciliation-current"; chmod 0600 "$temporary/iptables.reconciliation-current"
normalize_firewall_snapshot "$temporary/iptables.reconciliation-current" "$temporary/iptables.rules.reconciliation-current"
cmp -s "$temporary/iptables.rules.after" "$temporary/iptables.rules.reconciliation-current" || die 'current firewall rules differ from the canary result'

assert_business_locks
assert_workflow_inactive "$STRATEGIST_ID"
assert_workflow_inactive "$PRODUCER_ID"
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code IN ('$STRATEGIST_REGISTRY','$PRODUCER_REGISTRY') AND runtime_state='imported_inactive' AND trigger_state='workflow_inactive_only';")" = 2 || die 'core workflow registry is not restored inactive'
assert_container_ids_unchanged "$evidence/protected-container-ids.before"
assert_protected_health
assert_public_boundary
assert_firewall_boundary

strategist_before=$(evidence_value STRATEGIST_EXECUTIONS_BEFORE)
producer_before=$(evidence_value PRODUCER_EXECUTIONS_BEFORE)
external_before=$(evidence_value EXTERNAL_OPERATIONS_BEFORE)
posts_before=$(evidence_value POSTS_BEFORE)
leads_before=$(evidence_value LEADS_BEFORE)
test "$(workflow_execution_count "$STRATEGIST_ID")" -eq "$((strategist_before + 1))" || die 'strategist execution delta is not exactly one'
test "$(workflow_execution_count "$PRODUCER_ID")" -eq "$((producer_before + 1))" || die 'producer execution delta is not exactly one'
test "$(db_scalar 'SELECT count(*) FROM tanaghom.external_operations;')" = "$external_before" || die 'external operation count changed'
test "$(db_scalar 'SELECT count(*) FROM tanaghom.posts;')" = "$posts_before" || die 'post count changed'
test "$(db_scalar 'SELECT count(*) FROM tanaghom.leads;')" = "$leads_before" || die 'lead count changed'

export_all_workflows "$temporary/workflows.firewall-reconciliation.json"
node "$SCRIPT_DIR/workflow-contract.mjs" verify "$temporary/workflows.firewall-reconciliation.json" "$evidence/workflow-manifest.json" original
node "$SCRIPT_DIR/workflow-contract.mjs" compare-others "$evidence/workflows.before.json" "$temporary/workflows.firewall-reconciliation.json"
operator verify-pending "$TANAGHOM_CANARY_CAMPAIGN" >"$temporary/pending-approval.reconciled.json"
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit >"$temporary/n8n-audit.firewall-reconciliation.txt"

for file in iptables.rules.before iptables.rules.after iptables.reconciliation-current iptables.rules.reconciliation-current workflows.firewall-reconciliation.json pending-approval.reconciled.json n8n-audit.firewall-reconciliation.txt; do
  install -m 0600 "$temporary/$file" "$evidence/$file"
done
cat "$evidence/pending-approval.reconciled.json"

{
  echo "FIREWALL_EVIDENCE_RECONCILED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "READY_FOR_HUMAN_APPROVAL_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >>"$evidence/canary.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >"$evidence/SHA256SUMS"
rm -rf -- "$temporary"
trap - EXIT HUP INT TERM
echo 'PASS: the existing canary reached human approval; firewall rules are unchanged and no agent was rerun.'
