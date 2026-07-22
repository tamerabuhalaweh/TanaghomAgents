#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_hotfix_environment
test "${TANAGHOM_CONVERSATION_HOTFIX_ROLLBACK_AUTHORIZATION:-}" = 'ROLLBACK-THE-AUTHORIZED-CONVERSATION-SCHEMA-HOTFIX' || die 'explicit hotfix rollback authorization is absent'
evidence="/var/backups/tanaghom-$TANAGHOM_CONVERSATION_HOTFIX_ID"
test -s "$evidence/$WORKFLOW_ID.original.json" || die 'captured original workflow is missing'
test -s "$evidence/workflow-hotfix-manifest.json" || die 'hotfix manifest is missing'
assert_hotfix_database_boundary
assert_workflow_inactive
test "$(workflow_execution_count)" = "$(cat "$evidence/conversation-executions.before")" || die 'hotfix workflow has execution history; rollback requires separate review'
unpublish_workflow
import_hotfix_workflow_inactive "$evidence/$WORKFLOW_ID.original.json" explicit-rollback
export_all_workflows "$evidence/workflows.rollback.json"
node "$SCRIPT_DIR/hotfix-contract.mjs" verify-original "$evidence/workflows.rollback.json" "$evidence/workflow-hotfix-manifest.json"
assert_protected_units_active
assert_protected_containers_healthy
assert_public_boundary
assert_firewall_boundary
echo "ROLLED_BACK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/release.env"
echo 'PASS: original Conversation Intelligence workflow restored inactive; no database or provider state changed.'
