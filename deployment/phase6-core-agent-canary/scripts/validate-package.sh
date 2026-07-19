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
grep -q 'NODE_EXTRA_CA_CERTS="$DATABASE_CA_CERT"' "$package/scripts/common.sh"
grep -q 'BEGIN READ ONLY' "$package/scripts/canary-operator.mjs"
grep -q 'operator check-database' "$package/scripts/preflight.sh"
if grep -R -F 'operator seed "$TANAGHOM_CANARY_CAMPAIGN" | tee' --exclude=validate-package.sh "$package/scripts"; then
  echo 'seed operator exit can be masked by a pipeline' >&2; exit 1
fi
if grep -R -F 'operator queue-content "$TANAGHOM_CANARY_CAMPAIGN" | tee' --exclude=validate-package.sh "$package/scripts"; then
  echo 'content operator exit can be masked by a pipeline' >&2; exit 1
fi
if grep -R 'operator verify-' --exclude=validate-package.sh "$package/scripts" | grep -F '| tee'; then
  echo 'verification operator exit can be masked by a pipeline' >&2; exit 1
fi
if grep -F '| tee' "$package/scripts/run-canary.sh" "$package/scripts/verify-human-approval.sh"; then
  echo 'a critical canary command exit can be masked by tee' >&2; exit 1
fi
if grep -R -E 'Bearer [A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' --exclude=validate-package.sh "$package"; then
  echo 'possible secret found in canary package' >&2; exit 1
fi
echo 'PASS: core-agent canary package contract is complete and secret-free.'
