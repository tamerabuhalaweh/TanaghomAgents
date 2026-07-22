#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-runtime-agent-reconciliation"
for file in README.md RUNBOOK.md scripts/common.sh scripts/preflight.sh scripts/deploy-update.sh scripts/validate-release.sh scripts/rollback-update.sh scripts/test-refusal-paths.sh scripts/test-disposable-lifecycle.sh scripts/validate-package.sh; do
  test -s "$package/$file" || { echo "missing package file: $file" >&2; exit 1; }
done
sh -n "$package"/scripts/*.sh
grep -q 'EXPECTED_START_MIGRATION=0024_conversation_intelligence_worker_registry' "$package/scripts/common.sh"
grep -q 'TARGET_MIGRATION=0025_runtime_agent_reconciliation' "$package/scripts/common.sh"
grep -q 'assert_production_worktree_reviewed' "$package/scripts/preflight.sh"
grep -q 'trap automatic_rollback EXIT HUP INT TERM' "$package/scripts/deploy-update.sh"
grep -q 'assert_prior_agents_unchanged' "$package/scripts/validate-release.sh"
grep -q 'n8n audit' "$package/scripts/validate-release.sh"
grep -q 'ROLLBACK-THE-AUTHORIZED-RUNTIME-AGENT-RELEASE' "$package/scripts/rollback-update.sh"
grep -q 'preserves prior rows and used history' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'agent with immutable job history is retained' "$package/RUNBOOK.md"
if grep -R -E --exclude=validate-package.sh 'systemctl (stop|restart|reload)|docker (stop|restart|rm)|docker compose|iptables (-A|-I|-D|-N|-F|-X)' "$package/scripts"; then
  echo 'runtime-agent package may not mutate protected services or firewall' >&2; exit 1
fi
if grep -R -E --exclude=validate-package.sh '/opt/(smartlabs|n8n-smartlabs)|/data/|Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' "$package"; then
  echo 'runtime-agent package contains a protected path or secret shape' >&2; exit 1
fi
echo 'PASS: runtime-agent reconciliation package is syntax-valid, additive, data-preserving, reversible-before-use, secret-free, and protected-service scoped.'
