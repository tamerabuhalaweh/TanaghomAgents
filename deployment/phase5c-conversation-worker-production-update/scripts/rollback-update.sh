#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test "${TANAGHOM_WORKER_ROLLBACK_AUTHORIZATION:-}" = 'ROLLBACK-THE-AUTHORIZED-CONVERSATION-WORKER-RELEASE' || die 'explicit worker rollback authorization is absent'
evidence_dir="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
release_file="$evidence_dir/release.env"
test -s "$release_file" || die 'release evidence is missing'
grep -q '^COMMITTED_AT=' "$release_file" || die 'release never committed'
test ! -e "$evidence_dir/rollback-complete" || die 'release was already rolled back'

test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'database is not at the recorded target migration'
test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'all provider emergency stops must be active'
test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations exist; automatic rollback is unsafe'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code='$WORKFLOW_REGISTRY_CODE' AND runtime_state='imported_inactive' AND trigger_state='disabled';")" = 1 || die 'worker registry changed; automatic rollback is unsafe'
assert_workflow_inactive
assert_credential_encrypted
assert_runtime_role_least_privilege
assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"

delete_conversation_workflow
delete_conversation_credential
db_scalar "DROP ROLE $RUNTIME_ROLE;" >/dev/null
test "$(runtime_role_count)" = 0 || die 'runtime role was not removed'
test "$(db_scalar "UPDATE tanaghom.agent_workflow_registry SET runtime_state='available_not_imported',trigger_state='disabled',runtime_verified_at=statement_timestamp(),runtime_evidence='rollback-before-runtime-use' WHERE code='$WORKFLOW_REGISTRY_CODE' RETURNING 1;")" = 1 || die 'registry could not be prepared for rollback'
db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql"
test "$(latest_migration)" = "$EXPECTED_START_MIGRATION" || die 'migration rollback did not reach 0023'

export_all_workflows "$evidence_dir/n8n-workflows.rollback.json"
capture_credential_inventory "$evidence_dir/n8n-credentials.rollback.txt"
assert_existing_workflows_unchanged "$evidence_dir/n8n-workflows.before.json" "$evidence_dir/n8n-workflows.rollback.json"
cmp -s "$evidence_dir/n8n-credentials.before.txt" "$evidence_dir/n8n-credentials.rollback.txt" || die 'credential inventory was not restored'
assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_firewall_boundary
assert_public_boundary
printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$evidence_dir/rollback-complete"
chmod 0600 "$evidence_dir/rollback-complete" "$evidence_dir"/n8n-*.rollback.*
echo 'PASS: Conversation Intelligence release rolled back exactly to migration 0023 with prior n8n inventories restored.'
