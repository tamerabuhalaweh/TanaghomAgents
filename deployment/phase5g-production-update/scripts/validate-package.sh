#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase5g-production-update"
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
grep -q 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE' "$package/scripts/rollback-update.sh"
grep -q 'EXPECTED_START_MIGRATION=0019_notification_monitoring_destinations' "$package/scripts/common.sh"
grep -q 'TARGET_MIGRATION=0020_quality_rollout_control' "$package/scripts/common.sh"
test "$(grep -o '0020_[a-z_]*' "$package/scripts/common.sh" | sort -u | wc -l | tr -d ' ')" = 1
grep -q 'rollback_applied_migrations' "$package/scripts/deploy-update.sh"
grep -q 'assert_quality_tables_safe_to_drop' "$package/scripts/deploy-update.sh"
grep -q 'assert_quality_tables_safe_to_drop' "$package/scripts/rollback-update.sh"
grep -q 'n8n-container-ids.before' "$package/scripts/validate-release.sh"
grep -q 'quality_rollout_policies' "$package/scripts/validate-release.sh"
grep -q 'production-database-backup\\prepare-offserver-backup.ps1' "$package/scripts/prepare-offserver-backup.ps1"
grep -q -- '-ExpectedMigration $ExpectedMigration' "$package/scripts/prepare-offserver-backup.ps1"
grep -q 'postgres:17.6-alpine3.22@sha256:' "$shared_backup"
grep -q 'phase5\[fg\]' "$shared_backup"
grep -q -- '--network none' "$shared_backup"
grep -q '0020 rollback unexpectedly accepted quality evidence' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'No deployment is authorized by this document' "$package/RUNBOOK.md"

echo 'PASS: Phase 5G production update package is syntactically valid, evidence-preserving, and protected-service scoped.'
