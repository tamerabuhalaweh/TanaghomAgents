#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_hotfix_environment
evidence="/var/backups/tanaghom-$TANAGHOM_CONVERSATION_HOTFIX_ID"
test -d "$evidence" || die 'hotfix evidence directory is missing'
assert_hotfix_database_boundary
assert_workflow_inactive
test "$(workflow_execution_count)" = "$(cat "$evidence/conversation-executions.before")" || die 'Conversation Intelligence execution count changed during inactive import'
test "$(active_workflow_count)" = "$(cat "$evidence/active-workflows.before")" || die 'active n8n workflow count changed'
export_all_workflows "$evidence/workflows.after.json"
node "$SCRIPT_DIR/hotfix-contract.mjs" verify-target "$evidence/workflows.before.json" "$evidence/workflows.after.json" "$TARGET_WORKFLOW_SOURCE" "$evidence/workflow-hotfix-manifest.json"
capture_credential_inventory "$evidence/n8n-credentials.after.txt"
cmp -s "$evidence/n8n-credentials.before.txt" "$evidence/n8n-credentials.after.txt" || die 'n8n credential inventory changed'
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit > "$evidence/n8n-audit.txt"
assert_protected_container_ids_unchanged "$evidence/protected-container-ids.before"
assert_dashboard_id_unchanged "$evidence/dashboard-container-id.before"
assert_production_worktree_unchanged "$evidence/production-worktree.before"
assert_protected_units_active
assert_protected_containers_healthy
assert_public_boundary
assert_firewall_boundary
capture_firewall_boundary "$evidence/firewall.after"
cmp -s "$evidence/firewall.before" "$evidence/firewall.after" || die 'host firewall policy changed'
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null || die 'Tanaghom Nginx configuration changed'
echo 'PASS: inactive grammar hotfix and every n8n/protected boundary validated unchanged.'
