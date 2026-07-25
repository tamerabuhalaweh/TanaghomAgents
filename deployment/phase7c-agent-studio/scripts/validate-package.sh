#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase7c-agent-studio"

sh -n "$package"/scripts/*.sh
test -s "$package/RUNBOOK.md"
grep -q '0028_strategy_cadence_integrity' "$package/scripts/common.sh"
grep -q '0029_organization_agent_studio' "$package/scripts/common.sh"
grep -q 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE' "$package/scripts/rollback-update.sh"
grep -q 'rollback refused because organization Agent Studio data exists' "$package/scripts/rollback-update.sh"
grep -q '0029 rollback unexpectedly deleted organization agent data' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'No deployment is authorized by this document' "$package/RUNBOOK.md"
grep -q 'shared Phase 7B protected-service' "$package/RUNBOOK.md"
grep -q 'assert_predeployment_agent_studio_api_status' "$package/scripts/preflight.sh"
grep -q 'Post-deployment validation requires exactly' "$package/RUNBOOK.md"
grep -q 'capture_firewall_boundary "\$evidence/firewall.before"' "$package/scripts/deploy-update.sh"
grep -q 'package-owned firewall state changed' "$package/scripts/validate-release.sh"
! grep -q 'iptables-save' "$package/scripts/deploy-update.sh"

for file in "$package"/scripts/*.sh; do
  test -x "$file" || {
    echo "ERROR: Phase 7C script is not executable: $file" >&2
    exit 1
  }
  ! grep -Eq 'docker (stop|restart|rm|compose .+ (stop|restart|rm)).*(smartlabs|n8n|gemma|voice)' "$file"
  ! grep -Eq 'systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)' "$file"
  ! grep -Eq '(/opt/(smartlabs|n8n-smartlabs)|/data/)' "$file"
done

echo 'PASS: Phase 7C package is syntax-valid, single-migration, empty-data reversible, dashboard-only, and protected-service scoped.'
