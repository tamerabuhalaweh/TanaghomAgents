#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-conversation-shadow-canary"

for file in README.md RUNBOOK.md scripts/common.sh scripts/preflight.sh scripts/run-canary.sh scripts/restore-locks.sh scripts/canary-operator.mjs scripts/workflow-contract.mjs scripts/test-refusal-paths.sh scripts/test-disposable-lifecycle.sh scripts/validate-package.sh; do
  test -s "$package/$file" || { echo "missing package file: $file" >&2; exit 1; }
done
sh -n "$package"/scripts/*.sh
node --check "$package/scripts/canary-operator.mjs"
node --check "$package/scripts/workflow-contract.mjs"

grep -q 'EXPECTED_MIGRATION=0025_runtime_agent_reconciliation' "$package/scripts/common.sh"
grep -q 'WORKFLOW_ID=phase5ConversationIntelligenceV1' "$package/scripts/common.sh"
grep -q 'REVIEWED_DIRTY_DIFF_SHA256=94733679d940cc704f568fac6b488c4001638a39336ec843dd99306a64044c5d' "$root/deployment/phase5c-conversation-worker-production-update/scripts/common.sh"
grep -q "conversation_processing_mode<>'paused'" "$package/scripts/common.sh"
grep -q 'workflow_execution_count.*= 0\|workflow_execution_count)" = 0' "$package/scripts/preflight.sh"
grep -q 'assert-only-canary' "$package/scripts/run-canary.sh"
grep -q 'publish_workflow' "$package/scripts/run-canary.sh"
grep -q 'execute_workflow_once' "$package/scripts/run-canary.sh"
grep -q 'unpublish_workflow' "$package/scripts/run-canary.sh"
grep -q 'operator restore-locks' "$package/scripts/run-canary.sh"
grep -q 'operator verify-ready' "$package/scripts/run-canary.sh"
grep -q 'operator verify-finalized' "$package/scripts/run-canary.sh"
grep -q 'n8n audit' "$package/scripts/run-canary.sh"
grep -q 'trap cleanup EXIT HUP INT TERM' "$package/scripts/run-canary.sh"
grep -q 'integration_status.*disconnected' "$package/scripts/canary-operator.mjs"
grep -q 'external_action_count' "$package/scripts/canary-operator.mjs"
grep -q 'Supervisor Inbox\|Supervisor Inbox' "$package/RUNBOOK.md"
grep -q 'competing connected GHL integration' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'zero external actions passed in disposable PostgreSQL' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'schedule.*disabled' "$package/scripts/workflow-contract.mjs"
grep -q 'unexpected external endpoint' "$package/scripts/workflow-contract.mjs"

if grep -R -E --exclude=validate-package.sh 'systemctl (stop|restart|reload)|docker (stop|restart|rm)|docker compose' "$package/scripts"; then
  echo 'canary package may not stop, restart, remove, or recreate protected services' >&2; exit 1
fi
if grep -R -E --exclude=validate-package.sh 'iptables (-A|-I|-D|-N|-F|-X)|nft ' "$package/scripts"; then
  echo 'canary package may not mutate the firewall' >&2; exit 1
fi
if grep -R -E --exclude=validate-package.sh "https://[^[:space:]\"']*(gohighlevel|leadconnectorhq)|/opt/(smartlabs|n8n-smartlabs)|/data/" "$package"; then
  echo 'canary package contains a forbidden provider or protected filesystem mutation target' >&2; exit 1
fi
if grep -R -E 'Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' --exclude=validate-package.sh "$package"; then
  echo 'secret-shaped content found in Conversation Intelligence canary package' >&2; exit 1
fi
echo 'PASS: Conversation Intelligence canary package is syntax-valid, secret-free, exclusive, one-execution, fail-closed, and protected-service scoped.'
