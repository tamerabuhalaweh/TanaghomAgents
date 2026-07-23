#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-provider-runtime-readiness"
for file in README.md RUNBOOK.md scripts/common.sh scripts/validate-gateway-boundary.sh scripts/preflight.sh scripts/deploy-update.sh scripts/validate-release.sh scripts/rollback-update.sh scripts/validate-package.sh; do
  test -s "$package/$file" || { echo "missing package file: $file" >&2; exit 1; }
done
sh -n "$package"/scripts/*.sh
docker compose -f "$root/deployment/dashboard-canary/docker-compose.yml" \
  -f "$root/deployment/dashboard-public/docker-compose.yml" config --quiet
grep -q 'POSTIZ_AUTOMATION_RUNTIME_READY: "true"' "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'GHL_ACTION_RUNTIME_READY: "true"' "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'GHL_ACTION_RUNTIME_ENABLED: "false"' "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'GHL_CONTACT_SYNC_ENABLED: "false"' "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'GHL_WEBHOOK_INGRESS_ENABLED: "false"' "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'TANAGHOM_INTEGRATION_GATEWAY_URL: https://tanaghom.38-247-187-232.sslip.io' "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'GO-ENABLE-PROVEN-PROVIDER-RUNTIME-BOUNDARY' "$package/scripts/common.sh"
grep -q 'ROLLBACK-PROVEN-PROVIDER-RUNTIME-BOUNDARY' "$package/scripts/rollback-update.sh"
grep -q 'assert_safety_locks' "$package/scripts/preflight.sh"
grep -q 'assert_no_reconciliation_blocker' "$package/scripts/validate-release.sh"
grep -q 'assert_n8n_ids_unchanged' "$package/scripts/validate-release.sh"
grep -q 'n8n audit' "$package/scripts/validate-release.sh"
runtime="$package/scripts/common.sh $package/scripts/preflight.sh $package/scripts/deploy-update.sh $package/scripts/validate-release.sh $package/scripts/rollback-update.sh"
if grep -E 'systemctl (stop|restart|reload)|iptables (-A|-I|-D|-N|-F|-X)|nft |docker (stop|restart|rm)|docker compose.*(n8n|postgres|redis|egress-proxy)' $runtime; then
  echo 'protected-system mutation found in provider-runtime package' >&2
  exit 1
fi
if grep -E 'UPDATE tanaghom\.(automation_platform_controls|organization_automation_policies|organization_crm_policies)|INSERT INTO tanaghom\.external_operations' $runtime; then
  echo 'provider policy or operation mutation found in provider-runtime package' >&2
  exit 1
fi
if grep -RE --exclude=validate-package.sh \
  'Bearer[[:space:]]+[A-Za-z0-9_-]{20,}|postgresql://[^[:space:]:]+:[^[:space:]@]+@|sb_secret_[A-Za-z0-9_-]+' \
  "$package"; then
  echo 'secret-shaped content found in provider-runtime package' >&2
  exit 1
fi
echo 'PASS: provider-runtime package is dashboard-only, evidence-backed, fail-closed, and reversible.'
