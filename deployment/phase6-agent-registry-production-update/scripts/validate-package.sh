#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-agent-registry-production-update"
shared_backup="$root/deployment/production-database-backup/prepare-offserver-backup.ps1"

sh -n "$package"/scripts/*.sh
"$package/scripts/test-refusal-paths.sh"
test -s "$package/scripts/prepare-offserver-backup.ps1"
test -s "$package/RUNBOOK.md"

for file in "$package"/scripts/*.sh; do
  ! grep -Eq 'docker (stop|restart|rm|compose .+ (stop|restart|rm)).*(smartlabs|n8n|gemma|voice)' "$file"
  ! grep -Eq 'systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)' "$file"
  ! grep -Eq '(/opt/(smartlabs|n8n-smartlabs)|/data/)' "$file"
done

grep -q 'YES-I-AM-THE-AUTHORIZED-OWNER' "$package/scripts/common.sh"
grep -q 'sub(/\\r$/' "$package/scripts/common.sh"
grep -q 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE' "$package/scripts/rollback-update.sh"
grep -q 'EXPECTED_START_MIGRATION=0021_quality_baseline_shadow_pipeline' "$package/scripts/common.sh"
grep -q 'TARGET_MIGRATION=0022_agent_registry' "$package/scripts/common.sh"
test "$(grep -o '0022_[a-z_]*' "$package/scripts/common.sh" | sort -u | wc -l | tr -d ' ')" = 1
grep -q 'rollback_applied_migrations' "$package/scripts/deploy-update.sh"
grep -q 'assert_agent_registry_safe_to_drop' "$package/scripts/deploy-update.sh"
grep -q 'assert_agent_registry_safe_to_drop' "$package/scripts/rollback-update.sh"
grep -q 'n8n-container-ids.before' "$package/scripts/validate-release.sh"
grep -q 'agent_role_registry' "$package/scripts/validate-release.sh"
grep -q 'agent_workflow_registry' "$package/scripts/validate-release.sh"
grep -q "runtime_state='active'" "$package/scripts/validate-release.sh"
grep -q 'production-database-backup\\prepare-offserver-backup.ps1' "$package/scripts/prepare-offserver-backup.ps1"
grep -q -- '-ExpectedMigration $ExpectedMigration' "$package/scripts/prepare-offserver-backup.ps1"
grep -q 'postgres:17.6-alpine3.22@sha256:' "$shared_backup"
grep -q 'phase6' "$shared_backup"
grep -q -- '--network none' "$shared_backup"
grep -q '0022 rollback guard unexpectedly accepted modified registry evidence' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'Windows CRLF backup proof is accepted' "$package/scripts/test-refusal-paths.sh"
grep -q 'No deployment is authorized by this document' "$package/RUNBOOK.md"

echo 'PASS: Phase 6 Agent Registry production update package is syntax-valid, registry-exact, reversible, and protected-service scoped.'
