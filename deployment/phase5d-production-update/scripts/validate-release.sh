#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
evidence_dir="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
test -d "$evidence_dir" || die 'release evidence directory is missing'
test -s "$evidence_dir/n8n-container-ids.before" || die 'protected-container baseline is missing'

test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'target migration is not applied'
test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE provider IN ('postiz','ghl') AND emergency_stop IS TRUE;")" = 2 || die 'provider emergency stops are not active'
test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode <> 'manual';")" = 0 || die 'Postiz organization mode changed'
test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode <> 'manual' OR conversation_processing_mode <> 'paused' OR conversation_emergency_stop IS NOT TRUE;")" = 0 || die 'CRM/conversation policies are not locked'
test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations were created'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.conversations','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'n8n received conversation table access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.conversations','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'conversation worker received direct table access'
test "$(db_scalar "SELECT has_function_privilege('tanaghom_conversation_worker','tanaghom.assert_conversation_ai_reply_authority(uuid,uuid,bigint)','EXECUTE');")" = t || die 'dispatch-time authority check is unavailable'

assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
current_firewall=$(mktemp)
capture_firewall_boundary "$current_firewall"
cmp -s "$evidence_dir/firewall.before" "$current_firewall" || die 'package-owned firewall state changed'
rm -f "$current_firewall"
sha256sum -c "$evidence_dir/nginx.before.sha256" >/dev/null || die 'Tanaghom Nginx configuration changed'
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'dashboard is not healthy'
assert_firewall_boundary
assert_public_boundary
health=$(curl -fsS --max-time 10 http://127.0.0.1:3200/api/health)
echo "$health" | grep -q '"database":"connected"' || die 'dashboard database health failed'

test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" || die 'production source is not the target commit'
echo "PASS: Phase 5D release validation passed with zero provider operations."
