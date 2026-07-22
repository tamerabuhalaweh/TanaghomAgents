#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-conversation-schema-hotfix"
for file in README.md RUNBOOK.md scripts/common.sh scripts/preflight.sh scripts/deploy-update.sh scripts/validate-release.sh scripts/rollback-update.sh scripts/hotfix-contract.mjs scripts/test-refusal-paths.sh scripts/validate-package.sh; do
  test -s "$package/$file" || { echo "missing hotfix package file: $file" >&2; exit 1; }
done
sh -n "$package"/scripts/*.sh
node --check "$package/scripts/hotfix-contract.mjs"
grep -q 'EXPECTED_OLD_OPERATIONAL_SHA=623a54d57ffb46393bc64b544e5034af1b81e54043a0cc6e80ab7fe7d6ae39ac' "$package/scripts/common.sh"
grep -q 'activeState=false' "$package/scripts/common.sh"
grep -q 'trap automatic_rollback EXIT HUP INT TERM' "$package/scripts/deploy-update.sh"
grep -q 'verify-target' "$package/scripts/validate-release.sh"
grep -q 'ROLLBACK-THE-AUTHORIZED-CONVERSATION-SCHEMA-HOTFIX' "$package/scripts/rollback-update.sh"
grep -q 'local uniqueness' "$package/RUNBOOK.md"
grep -q 'retrieved knowledge' "$package/RUNBOOK.md"
node "$package/scripts/hotfix-contract.mjs" validate-target "$root/n8n/workflows/phase5/conversation-intelligence.v1.json" 623a54d57ffb46393bc64b544e5034af1b81e54043a0cc6e80ab7fe7d6ae39ac
if grep -R -E --exclude=validate-package.sh 'systemctl (stop|restart|reload)|docker (stop|restart|rm)|docker compose|iptables (-A|-I|-D|-N|-F|-X)' "$package/scripts"; then
  echo 'hotfix package may not mutate protected services or firewall' >&2; exit 1
fi
if grep -R -E --exclude=validate-package.sh '/opt/(smartlabs|n8n-smartlabs)|/data/|Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@' "$package"; then
  echo 'hotfix package contains a protected path or secret shape' >&2; exit 1
fi
echo 'PASS: Conversation schema hotfix package is pinned, inactive-only, reversible-before-use, secret-free, and protected-service scoped.'
