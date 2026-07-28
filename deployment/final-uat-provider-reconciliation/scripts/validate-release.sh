#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_reconciliation_environment
evidence="/var/backups/tanaghom-$TANAGHOM_PROVIDER_RECONCILIATION_ID"
test -s "$evidence/n8n-container-ids.before" || die 'n8n identity evidence is missing'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = \
  "$TANAGHOM_TARGET_COMMIT" ||
  die 'production source is not the target'
test -z "$(production_unexpected_changes)" ||
  die 'production checkout is dirty'
test "$(container_health "$DASHBOARD_CONTAINER")" = healthy ||
  die 'dashboard is unhealthy'

assert_target_runtime_ready
assert_target_postiz_allowlist
assert_secret_metadata
assert_gateway_credential_metadata
assert_safety_locks
assert_pre_onboarding_state
assert_no_reconciliation_blocker
assert_dashboard_network_boundary
assert_public_boundary
assert_provider_network_reachable | tee "$evidence/provider-network.after.txt"
assert_protected_n8n_healthy
assert_n8n_ids_unchanged "$evidence/n8n-container-ids.before"

current_firewall=$(mktemp)
capture_reconciliation_firewall "$current_firewall"
cmp -s "$evidence/firewall.before" "$current_firewall" ||
  die 'package-owned firewall changed'
rm -f "$current_firewall"
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null ||
  die 'Nginx configuration changed'
sha256sum -c "$evidence/squid.before.sha256" >/dev/null ||
  die 'Squid configuration changed'
test "$(provider_state_fingerprint)" = "$(cat "$evidence/provider-state.before")" ||
  die 'provider/channel/action state changed'

validate_gateway_boundary | tee "$evidence/gateway-boundary.after.txt"
docker exec --user node smartlabs-n8n-n8n-1 n8n audit \
  > "$evidence/n8n-audit.after.txt"
container_env | grep -E \
  '^(AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED|POSTIZ_AUTOMATION_RUNTIME_READY|GHL_ACTION_RUNTIME_READY|GHL_ACTION_RUNTIME_ENABLED|GHL_CONTACT_SYNC_ENABLED|GHL_WEBHOOK_INGRESS_ENABLED|POSTIZ_ALLOWED_BASE_URLS|TANAGHOM_INTEGRATION_GATEWAY_URL)=' \
  > "$evidence/dashboard-env.after"
chmod 0600 "$evidence"/*

echo 'PASS: new Postiz API allowlist is live while all provider actions and safety locks remain closed.'
