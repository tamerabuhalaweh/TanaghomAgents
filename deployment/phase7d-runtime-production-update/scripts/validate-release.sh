#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"

test -s "$evidence/n8n-container-ids.before" ||
  die 'protected n8n identity evidence is missing'
assert_target_database
assert_login_roles_least_privilege
assert_package_credentials_encrypted
assert_shared_credentials
assert_package_workflows_inactive
assert_safety_locks
assert_protected_units_active
assert_protected_containers_healthy
assert_n8n_ids_unchanged "$evidence/n8n-container-ids.before"
assert_dashboard_network_boundary
assert_firewall_boundary

sha256sum -c "$evidence/nginx.before.sha256" >/dev/null ||
  die 'Nginx configuration changed'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null ||
  die 'reviewed Squid configuration changed'
current_firewall=$(mktemp)
capture_firewall_boundary "$current_firewall"
cmp -s "$evidence/firewall.before" "$current_firewall" || {
  rm -f "$current_firewall"
  die 'package-owned firewall state changed'
}
rm -f "$current_firewall"

assert_public_boundary
assert_running_gateway_locked
health=$(curl -fsS --max-time 10 http://127.0.0.1:3200/api/health)
echo "$health" | grep -q '"database":"connected"' ||
  die 'dashboard database health failed'

echo 'PASS: Phase 7D runtime is installed inactive, credential-separated, fail-closed and zero-execution.'
