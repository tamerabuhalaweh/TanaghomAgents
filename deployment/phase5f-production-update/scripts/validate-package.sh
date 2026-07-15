#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase5f-production-update"
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
grep -q '0014_supervised_conversation_ownership' "$package/scripts/common.sh"
grep -q '0015_governed_ghl_actions' "$package/scripts/common.sh"
grep -q '0019_notification_monitoring_destinations' "$package/scripts/common.sh"
test "$(grep -o '001[5-9]_[a-z_]*' "$package/scripts/common.sh" | sort -u | wc -l | tr -d ' ')" = 5
grep -q 'rollback_applied_migrations' "$package/scripts/deploy-update.sh"
grep -q 'assert_release_tables_empty' "$package/scripts/deploy-update.sh"
grep -q 'assert_release_tables_empty' "$package/scripts/rollback-update.sh"
grep -q 'n8n-container-ids.before' "$package/scripts/validate-release.sh"
grep -q 'runtime_ready IS NOT FALSE' "$package/scripts/validate-release.sh"
grep -q 'production-database-backup\\prepare-offserver-backup.ps1' "$package/scripts/prepare-offserver-backup.ps1"
grep -q 'postgres:17.6-alpine3.22@sha256:' "$shared_backup"
grep -q -- '--network none' "$shared_backup"
grep -q 'unexpectedly accepted customer notification data' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'No deployment is authorized by this document' "$package/RUNBOOK.md"

echo 'PASS: Phase 5F production update package is syntactically valid, rollback-safe, and protected-service scoped.'
