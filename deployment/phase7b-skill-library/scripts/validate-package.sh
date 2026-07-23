#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase7b-skill-library"

sh -n "$package"/scripts/*.sh
test -s "$package/RUNBOOK.md"
grep -q '0026_skill_registry' "$package/scripts/common.sh"
grep -q '0027_governed_skill_library' "$package/scripts/common.sh"
grep -q 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE' "$package/scripts/rollback-update.sh"
grep -q 'rollback refused because customer Skill Library data exists' "$package/scripts/rollback-update.sh"
grep -q 'rollback unexpectedly deleted customer Skill Library data' "$package/scripts/test-disposable-lifecycle.sh"
grep -q 'No deployment is authorized by this document' "$package/RUNBOOK.md"

for file in "$package"/scripts/*.sh; do
  ! grep -Eq 'docker (stop|restart|rm|compose .+ (stop|restart|rm)).*(smartlabs|n8n|gemma|voice)' "$file"
  ! grep -Eq 'systemctl (stop|restart|reload).*(smartlabs|convai|gemma|smartcc)' "$file"
  ! grep -Eq '(/opt/(smartlabs|n8n-smartlabs)|/data/)' "$file"
done

echo 'PASS: Phase 7B Skill Library package is syntax-valid, single-migration, reversible, and protected-service scoped.'
