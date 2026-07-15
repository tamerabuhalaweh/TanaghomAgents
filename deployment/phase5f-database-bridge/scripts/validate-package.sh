#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase5f-database-bridge"
shared_backup="$root/deployment/production-database-backup/prepare-offserver-backup.ps1"
sh -n "$package"/scripts/*.sh
"$package/scripts/test-refusal-paths.sh"
test -s "$package/RUNBOOK.md"

for file in "$package"/scripts/*.sh; do
  ! grep -Eq 'docker (build|pull|stop|restart|rm)|docker compose .+ (up|down|stop|restart|rm)|compose (build|up|down|stop|restart|rm)' "$file"
  ! grep -Eq 'systemctl (stop|restart|reload)|iptables (-A|-I|-D|-N|-F|-X)|nft ' "$file"
  ! grep -Eq '(/opt/(smartlabs|n8n-smartlabs)|/data/)' "$file"
done

grep -q 'EXPECTED_START_MIGRATION=0009_postiz_automation_controls' "$package/scripts/common.sh"
grep -q 'TARGET_MIGRATION=0014_supervised_conversation_ownership' "$package/scripts/common.sh"
grep -q '0010_postiz_performance_monitoring' "$package/scripts/common.sh"
grep -q 'rollback_applied_migrations' "$package/scripts/deploy-bridge.sh"
grep -q 'assert_dashboard_identity_unchanged' "$package/scripts/validate-release.sh"
grep -q 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-BRIDGE' "$package/scripts/rollback-bridge.sh"
grep -q 'PostgreSQL 17.6' "$package/RUNBOOK.md"
grep -q 'No dashboard image is built' "$package/RUNBOOK.md"
grep -q 'postgres:17.6-alpine3.22@sha256:' "$shared_backup"
grep -q 'RESTORE_VERIFIED=YES' "$shared_backup"
grep -q -- '--network none' "$shared_backup"

echo 'PASS: database-only bridge package is syntactically valid and cannot operate on dashboard or protected services.'
