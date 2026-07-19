#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-core-agent-canary"

for file in README.md RUNBOOK.md scripts/common.sh scripts/preflight.sh scripts/run-canary.sh scripts/restore-workflows.sh scripts/verify-human-approval.sh scripts/validate-package.sh scripts/test-refusal-paths.sh scripts/workflow-contract.mjs scripts/canary-operator.mjs; do
  test -s "$package/$file" || { echo "missing package file: $file" >&2; exit 1; }
done
sh -n "$package"/scripts/*.sh
node --check "$package/scripts/workflow-contract.mjs"
node --check "$package/scripts/canary-operator.mjs"

grep -q "scheduleTrigger.*node.disabled = true\|node.type === \"n8n-nodes-base.scheduleTrigger\".*node.disabled = true" "$package/scripts/workflow-contract.mjs"
grep -q 'publish_workflow "$STRATEGIST_ID"' "$package/scripts/run-canary.sh"
grep -q 'unpublish_workflow "$STRATEGIST_ID"' "$package/scripts/run-canary.sh"
grep -q 'publish_workflow "$PRODUCER_ID"' "$package/scripts/run-canary.sh"
grep -q 'unpublish_workflow "$PRODUCER_ID"' "$package/scripts/run-canary.sh"
grep -q 'max_items: 2' "$package/scripts/canary-operator.mjs"
grep -q "budget_target: 0" "$package/scripts/canary-operator.mjs"
grep -q "forbidden_jobs" "$package/scripts/canary-operator.mjs"
if grep -R -E 'Bearer [A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' --exclude=validate-package.sh "$package"; then
  echo 'possible secret found in canary package' >&2; exit 1
fi
echo 'PASS: core-agent canary package contract is complete and secret-free.'
