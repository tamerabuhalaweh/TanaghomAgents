#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase7d-runtime-production-update"

sh -n "$package"/scripts/*.sh
test -s "$package/RUNBOOK.md"
grep -q '0029_organization_agent_studio' "$package/scripts/common.sh"
grep -q '0030_policy_resolved_agent_runtime 0031_policy_runtime_executors_certification' \
  "$package/scripts/common.sh"
grep -q 'AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED: "false"' \
  "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'GO-INSTALL-LOCKED-PHASE7D-RUNTIME' "$package/scripts/common.sh"
grep -q 'ROLLBACK-LOCKED-PHASE7D-RUNTIME' "$package/scripts/rollback-update.sh"
grep -q 'No deployment is authorized by this package' "$package/RUNBOOK.md"
grep -q 'six workflows' "$package/RUNBOOK.md"
grep -q 'four generated PostgreSQL login identities' "$package/RUNBOOK.md"
grep -q 'Adapters, schedules, provider execution and runtime claims remain disabled' \
  "$package/RUNBOOK.md"
grep -q 'automatic_rollback' "$package/scripts/deploy-update.sh"
grep -q 'n8n audit' "$package/scripts/deploy-update.sh"
grep -q 'assert_running_gateway_locked' "$package/scripts/validate-release.sh"
grep -q 'runtime_evidence_count' "$package/scripts/rollback-update.sh"
! grep -q 'iptables-save' "$package/scripts/deploy-update.sh"

for file in "$package"/scripts/*.sh; do
  test -x "$file" || {
    echo "ERROR: Phase 7D script is not executable: $file" >&2
    exit 1
  }
  ! grep -Eq \
    'docker (stop|restart|rm|compose .+ (stop|restart|rm)).*(smartlabs|n8n|gemma|voice)' \
    "$file"
  ! grep -Eq \
    'systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)' \
    "$file"
  ! grep -Eq '(/opt/(smartlabs|n8n-smartlabs)|/data/)' "$file"
done

echo 'PASS: Phase 7D package is syntax-valid, two-migration, six-workflow, four-login, dashboard-only and protected-service scoped.'
