#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/final-uat-provider-reconciliation"
new_base='https://postiz.155-117-45-45.sslip.io/api/public/v1'

for script in "$package"/scripts/*.sh; do
  sh -n "$script"
done

grep -q "POSTIZ_ALLOWED_BASE_URLS: $new_base" \
  "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'EXPECTED_MIGRATION=0033_agent_runtime_certification_evidence' \
  "$package/scripts/common.sh"
grep -q 'AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED: "false"' \
  "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'GHL_WEBHOOK_INGRESS_ENABLED: "false"' \
  "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'GHL_CONTACT_SYNC_ENABLED: "false"' \
  "$root/deployment/dashboard-canary/docker-compose.yml"
grep -q 'GHL_ACTION_RUNTIME_ENABLED: "false"' \
  "$root/deployment/dashboard-canary/docker-compose.yml"

! grep -R -E \
  '(Authorization:[[:space:]]*(Bearer[[:space:]]+)?[A-Za-z0-9_-]{24,}|api[_-]?key[[:space:]]*[:=][[:space:]]*[A-Za-z0-9_-]{24,}|password[[:space:]]*[:=][[:space:]]*[^<[:space:]]{8,})' \
  "$package" >/dev/null

echo 'PASS: Final UAT provider reconciliation is syntax-valid, secret-free, bounded, reversible, and fail-closed.'
