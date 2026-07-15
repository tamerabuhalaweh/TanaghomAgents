#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase5d-production-update"

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
grep -q '0010_postiz_performance_monitoring' "$package/scripts/common.sh"
grep -q '0014_supervised_conversation_ownership' "$package/scripts/common.sh"
grep -q 'rollback_applied_migrations' "$package/scripts/deploy-update.sh"
grep -q 'n8n-container-ids.before' "$package/scripts/validate-release.sh"
grep -q 'actually restored' "$package/scripts/test-disposable-backup.sh"

echo 'PASS: Phase 5D production update package is syntactically valid and protected-service scoped.'
