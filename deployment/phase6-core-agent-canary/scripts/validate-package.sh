#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-core-agent-canary"

for file in README.md RUNBOOK.md scripts/common.sh scripts/preflight.sh scripts/run-canary.sh scripts/restore-workflows.sh scripts/reconcile-firewall-evidence.sh scripts/verify-human-approval.sh scripts/validate-package.sh scripts/test-refusal-paths.sh scripts/workflow-contract.mjs scripts/canary-operator.mjs; do
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
grep -q 'TANAGHOM_DATABASE_SSL_MODE=verify-full' "$package/scripts/common.sh"
grep -q 'searchParams.set("sslmode", "verify-full")' "$package/scripts/canary-operator.mjs"
grep -q 'BEGIN READ ONLY' "$package/scripts/canary-operator.mjs"
grep -q 'operator check-database' "$package/scripts/preflight.sh"
grep -q 'normalize_firewall_snapshot "\$evidence/iptables.before" "\$evidence/iptables.rules.before"' "$package/scripts/run-canary.sh"
grep -q 'normalize_firewall_snapshot "\$evidence/iptables.after" "\$evidence/iptables.rules.after"' "$package/scripts/run-canary.sh"
grep -q 'cmp -s "\$evidence/iptables.rules.before" "\$evidence/iptables.rules.after"' "$package/scripts/run-canary.sh"
grep -q 'YES-RECONCILE-VOLATILE-FIREWALL-EVIDENCE' "$package/scripts/reconcile-firewall-evidence.sh"
grep -q 'READY_FOR_HUMAN_APPROVAL_AT=' "$package/scripts/reconcile-firewall-evidence.sh"
if grep -E 'publish_workflow|execute_workflow_once|operator (seed|queue-content)' "$package/scripts/reconcile-firewall-evidence.sh"; then
  echo 'firewall evidence reconciliation must not rerun an agent' >&2; exit 1
fi
if grep -q 'cmp -s "\$evidence/iptables.before" "\$evidence/iptables.after"' "$package/scripts/run-canary.sh"; then
  echo 'raw iptables-save metadata must not be compared as firewall policy' >&2; exit 1
fi
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

. "$package/scripts/common.sh"
firewall_fixture=$(mktemp -d)
trap 'rm -rf -- "$firewall_fixture"' EXIT HUP INT TERM
printf '%s\n' '# Generated at first timestamp' '*filter' ':INPUT ACCEPT [1:2]' '-A INPUT -p tcp --dport 443 -j ACCEPT' 'COMMIT' '# Completed at first timestamp' >"$firewall_fixture/before"
printf '%s\n' '# Generated at second timestamp' '*filter' ':INPUT ACCEPT [300:400]' '-A INPUT -p tcp --dport 443 -j ACCEPT' 'COMMIT' '# Completed at second timestamp' >"$firewall_fixture/counter-drift"
printf '%s\n' '# Generated at third timestamp' '*filter' ':INPUT ACCEPT [500:600]' '-A INPUT -p tcp --dport 444 -j ACCEPT' 'COMMIT' '# Completed at third timestamp' >"$firewall_fixture/rule-change"
normalize_firewall_snapshot "$firewall_fixture/before" "$firewall_fixture/before.rules"
normalize_firewall_snapshot "$firewall_fixture/counter-drift" "$firewall_fixture/counter-drift.rules"
normalize_firewall_snapshot "$firewall_fixture/rule-change" "$firewall_fixture/rule-change.rules"
cmp -s "$firewall_fixture/before.rules" "$firewall_fixture/counter-drift.rules" || { echo 'firewall normalization did not exclude timestamps and counters' >&2; exit 1; }
if cmp -s "$firewall_fixture/before.rules" "$firewall_fixture/rule-change.rules"; then
  echo 'firewall normalization concealed a rule change' >&2; exit 1
fi
rm -rf -- "$firewall_fixture"
trap - EXIT HUP INT TERM

if grep -R -E 'Bearer [A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' --exclude=validate-package.sh "$package"; then
  echo 'possible secret found in canary package' >&2; exit 1
fi
echo 'PASS: core-agent canary package contract is complete and secret-free.'
