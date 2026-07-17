#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase5g-shadow-production-update"
shared_backup="$root/deployment/production-database-backup/prepare-offserver-backup.ps1"

sh -n "$package"/scripts/*.sh
"$package/scripts/test-refusal-paths.sh"
test -s "$package/scripts/prepare-offserver-backup.ps1"
test -s "$package/RUNBOOK.md"

for file in "$package"/scripts/*.sh; do
  ! grep -Eq 'docker (stop|restart|rm|compose .+ (stop|restart|rm)).*(smartlabs|gemma|voice|smartcc)' "$file"
  ! grep -Eq 'systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)' "$file"
  ! grep -Eq '(/opt/(smartlabs|n8n-smartlabs)|/data/)' "$file"
done

grep -q 'EXPECTED_START_MIGRATION=0020_quality_rollout_control' "$package/scripts/common.sh"
grep -q 'TARGET_MIGRATION=0021_quality_baseline_shadow_pipeline' "$package/scripts/common.sh"
grep -q 'WORKFLOW_ID=phase5gQualityShadowEvaluatorV1' "$package/scripts/common.sh"
grep -q 'N8N_EXPECTED_VERSION=2.26.8' "$package/scripts/common.sh"
grep -q 'assert_workflow_absent' "$package/scripts/preflight.sh"
grep -q 'import:workflow.*--activeState=false' "$package/scripts/deploy-update.sh"
grep -q 'workflow_remote="/home/node/' "$package/scripts/deploy-update.sh"
grep -q 'docker exec -u root.*test -s.*workflow_remote' "$package/scripts/deploy-update.sh"
grep -q 'docker exec -u node.*test -r.*workflow_remote' "$package/scripts/deploy-update.sh"
grep -q 'n8n audit' "$package/scripts/deploy-update.sh"
grep -q 'assert_existing_workflows_unchanged' "$package/scripts/deploy-update.sh"
grep -q '/home/node/tanaghom-workflows-' "$package/scripts/common.sh"
grep -q 'docker exec -u node.*test -s.*remote' "$package/scripts/common.sh"
grep -q 'docker cp.*n8n_container.*container_export' "$package/scripts/test-disposable-workflow-lifecycle.sh"
grep -q 'delete_quality_workflow' "$package/scripts/rollback-update.sh"
grep -q 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-SHADOW-RELEASE' "$package/scripts/rollback-update.sh"
grep -q '0021 rollback unexpectedly accepted metric evidence' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'host-copied, container-imported inactive, container-exported, host-verified, audited, and transactionally removed exactly one zero-execution shadow workflow' "$package/scripts/test-disposable-workflow-lifecycle.sh"
grep -q 'ExpectedMigration = .0020_quality_rollout_control.' "$package/scripts/prepare-offserver-backup.ps1"
grep -q 'postgres:17.6-alpine3.22@sha256:' "$shared_backup"
grep -q -- '--network none' "$shared_backup"
grep -q 'No deployment is authorized by this document' "$package/RUNBOOK.md"

echo 'PASS: Phase 5G shadow production package is syntax-valid, inactive-by-construction, exact, reversible, and protected-service scoped.'
