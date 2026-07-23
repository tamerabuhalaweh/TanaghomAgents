#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-uat-activation"

sh -n "$package"/scripts/*.sh
node "$package/scripts/workflow-contract.mjs" "$root"
"$package/scripts/test-refusal-paths.sh"
test -s "$package/README.md"
test -s "$package/RUNBOOK.md"

grep -q 'EXPECTED_MIGRATION=0025_runtime_agent_reconciliation' "$package/scripts/common.sh"
grep -q 'N8N_EXPECTED_VERSION=2.26.8' "$package/scripts/common.sh"
grep -q 'REVIEWED_DIRTY_DIFF_SHA256=94733679d940cc704f568fac6b488c4001638a39336ec843dd99306a64044c5d' "$package/scripts/common.sh"
grep -q 'ACTIVATE-REVIEWED-TANAGHOM-UAT-WORKERS' "$package/scripts/common.sh"
grep -q 'ROLLBACK-AUTHORIZED-TANAGHOM-UAT-ACTIVATION' "$package/scripts/rollback-activation.sh"
grep -q 'publish:workflow --id' "$package/scripts/common.sh"
grep -q 'unpublish:workflow --id' "$package/scripts/common.sh"
grep -q 'restart_n8n_runtime' "$package/scripts/deploy-activation.sh"
grep -q "runtime_state='active',trigger_state='enabled'" "$package/scripts/deploy-activation.sh"
grep -q "runtime_state='active',trigger_state='disabled'" "$package/scripts/deploy-activation.sh"
grep -q 'n8n audit' "$package/scripts/deploy-activation.sh"
grep -q 'delete_new_workflows' "$package/scripts/rollback-activation.sh"
grep -q 'assert_zero_provider_activity' "$package/scripts/preflight.sh"
grep -Fq "organization.slug ~ '^conversation-canary-[0-9]{8}t[0-9]{6}z$'" "$package/scripts/common.sh"
grep -Fq "connection.base_url='https://ghl-shadow-canary.invalid.test'" "$package/scripts/common.sh"
grep -Fq "job.status IN ('queued','running','waiting_approval')" "$package/scripts/common.sh"
grep -q 'assert_business_locks' "$package/scripts/preflight.sh"

runtime_scripts="$package/scripts/common.sh $package/scripts/preflight.sh $package/scripts/deploy-activation.sh $package/scripts/validate-release.sh $package/scripts/rollback-activation.sh"
if grep -E 'docker (stop|rm|kill|compose)|systemctl (stop|restart|reload)|(/opt/(smartlabs|smartcc)|/data/)' $runtime_scripts; then
  echo 'forbidden protected-system mutation found in runtime scripts' >&2
  exit 1
fi
if grep -E 'docker restart[[:space:]]+[^"$]' $runtime_scripts; then
  echo 'unscoped container restart found in runtime scripts' >&2
  exit 1
fi
if grep -E 'iptables|nft|nginx|convai|voice|smartcc|gemma4-26b-a4b-vllm-canary' $runtime_scripts; then
  echo 'forbidden protected-system reference found in runtime scripts' >&2
  exit 1
fi

if grep -RE --exclude=validate-package.sh \
  'Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@|sb_secret_[A-Za-z0-9_-]+' \
  "$package"; then
  echo 'secret-shaped content found in UAT activation package' >&2
  exit 1
fi

echo 'PASS: UAT activation package is syntax-valid, secret-free, Tanaghom-only, fail-closed, and exactly reversible.'
