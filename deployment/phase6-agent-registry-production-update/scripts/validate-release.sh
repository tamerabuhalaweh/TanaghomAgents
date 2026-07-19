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
test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode <> 'manual' OR conversation_processing_mode <> 'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode <> 'manual' OR proactive_message_mode <> 'disabled' OR action_emergency_stop IS NOT TRUE;")" = 0 || die 'CRM, conversation, or GHL action policy is not locked'
test "$(db_scalar "SELECT count(*) FROM tanaghom.notification_delivery_controls WHERE runtime_ready IS NOT FALSE OR emergency_stop IS NOT TRUE;")" = 0 || die 'notification delivery did not remain locked'
test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations were created'
assert_agent_registry_safe_to_drop
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_role_registry;")" = 4 || die 'business-agent registry count is not four'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry;")" = 7 || die 'workflow-agent registry count is not seven'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE release_state='available';")" = 7 || die 'a reviewed workflow is not release-available'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='active';")" = 0 || die 'the registry unexpectedly reports an active workflow'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='imported_inactive';")" = 4 || die 'imported-inactive workflow evidence differs from the reviewed runtime snapshot'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='available_not_imported';")" = 3 || die 'not-imported workflow evidence differs from the reviewed runtime snapshot'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.conversations','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'n8n received conversation table access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.notification_destinations','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'n8n received notification-secret access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.quality_rollout_policies','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'n8n received quality rollout table access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.quality_evaluation_snapshots','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'conversation worker received quality evidence table access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.quality_rollout_policies','UPDATE');")" = f || die 'dashboard API received direct quality-policy mutation access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.ghl_action_jobs','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'conversation worker received direct GHL action table access'
test "$(db_scalar "SELECT has_function_privilege('tanaghom_conversation_worker','tanaghom.assert_conversation_ai_reply_authority(uuid,uuid,bigint)','EXECUTE');")" = t || die 'dispatch-time authority check is unavailable'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_n8n_worker','tanaghom.agent_workflow_registry','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'n8n received Agent Registry table access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_conversation_worker','tanaghom.agent_workflow_registry','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'conversation worker received Agent Registry table access'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.agent_role_registry','SELECT');")" = t || die 'dashboard API cannot read business-agent roles'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.agent_workflow_registry','SELECT');")" = t || die 'dashboard API cannot read workflow agents'
test "$(db_scalar "SELECT has_table_privilege('tanaghom_api','tanaghom.agent_workflow_registry','INSERT,UPDATE,DELETE');")" = f || die 'dashboard API received Agent Registry write access'

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
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/system/monitoring")" = 401 || die 'monitoring API authentication boundary changed'
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/admin/notifications")" = 401 || die 'notification API authentication boundary changed'
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/quality")" = 401 || die 'quality API authentication boundary changed'
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/agents")" = 307 || die 'Agents page authentication boundary changed'
health=$(curl -fsS --max-time 10 http://127.0.0.1:3200/api/health)
echo "$health" | grep -q '"database":"connected"' || die 'dashboard database health failed'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_TARGET_COMMIT" || die 'production source is not the target commit'

echo 'PASS: Phase 6 Agent Registry release validation passed with four roles, seven specialized workers, zero active workflows, and unchanged protected boundaries.'
