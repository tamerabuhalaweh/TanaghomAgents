#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
evidence_dir=$(evidence_dir)
test -d "$evidence_dir" || die 'bridge evidence directory is missing'
test -s "$evidence_dir/n8n-container-ids.before" || die 'protected-container baseline is missing'
test -s "$evidence_dir/dashboard-identity.before" || die 'dashboard baseline is missing'

assert_bridge_default_state
test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.conversations','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'n8n received conversation table access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.conversations','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'conversation worker received direct conversation table access'
test "$(db_scalar "SELECT has_function_privilege('tanaghom_conversation_worker','tanaghom.assert_conversation_ai_reply_authority(uuid,uuid,bigint)','EXECUTE');")" = t || die 'dispatch-time authority check is unavailable'

assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_dashboard_identity_unchanged "$evidence_dir/dashboard-identity.before"
current_firewall=$(mktemp)
capture_firewall_boundary "$current_firewall"
cmp -s "$evidence_dir/firewall.before" "$current_firewall" || die 'package-owned firewall state changed'
rm -f "$current_firewall"
sha256sum -c "$evidence_dir/nginx.before.sha256" >/dev/null || die 'Tanaghom Nginx configuration changed'
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'dashboard is not healthy'
assert_firewall_boundary
assert_public_bridge_boundary
health=$(curl -fsS --max-time 10 http://127.0.0.1:3200/api/health)
echo "$health" | grep -q '"database":"connected"' || die 'dashboard database health failed'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" || die 'production source changed during database bridge'

echo 'PASS: database-only bridge reached 0014 with the dashboard and every protected boundary unchanged.'
