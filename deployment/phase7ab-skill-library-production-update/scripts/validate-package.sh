#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase7ab-skill-library-production-update"

sh -n "$package"/scripts/*.sh
"$package/scripts/test-refusal-paths.sh"
test -s "$package/RUNBOOK.md"

for file in "$package"/scripts/*.sh; do
  ! grep -Eq 'docker (stop|restart|rm|compose .+ (stop|restart|rm)).*(smartlabs|n8n|gemma|voice)' "$file"
  ! grep -Eq 'systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)' "$file"
  ! grep -Eq '(/opt/(smartlabs|n8n-smartlabs)|/data/)' "$file"
done

grep -q 'EXPECTED_START_MIGRATION=0025_runtime_agent_reconciliation' "$package/scripts/common.sh"
grep -q 'TARGET_MIGRATION=0027_governed_skill_library' "$package/scripts/common.sh"
grep -q "PENDING_MIGRATIONS='0026_skill_registry 0027_governed_skill_library'" "$package/scripts/common.sh"
grep -q 'ALLOWED_PRODUCTION_CHANGE=' "$package/scripts/common.sh"
grep -q 'assert_skill_registry_safe_to_drop' "$package/scripts/deploy-update.sh"
grep -q 'rollback_applied_migrations' "$package/scripts/deploy-update.sh"
grep -q 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE' "$package/scripts/rollback-update.sh"
grep -q '0027 rollback unexpectedly deleted customer Skill Library data' "$package/scripts/test-disposable-lifecycle.sh"
grep -q '0026 rollback unexpectedly deleted changed platform Skill Registry data' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'No deployment is authorized by this document' "$package/RUNBOOK.md"
grep -q 'No off-server backup is required' "$package/RUNBOOK.md"

test "$(grep 'compose \(build\|up\)' "$package/scripts/deploy-update.sh" | grep -vc dashboard || true)" = 0
test "$(grep 'compose up' "$package/scripts/rollback-update.sh" | grep -vc dashboard || true)" = 0

echo 'PASS: Phase 7AB package is two-migration exact, reversible, dashboard-only, and protected-service scoped.'
