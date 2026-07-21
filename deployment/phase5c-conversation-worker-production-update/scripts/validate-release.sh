#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
evidence_dir="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
test -s "$evidence_dir/n8n-container-ids.before" || die 'container baseline is missing'
test -s "$evidence_dir/n8n-workflows.before.json" || die 'workflow baseline is missing'
test -s "$evidence_dir/n8n-workflows.after.json" || die 'post-import workflow evidence is missing'
test -s "$evidence_dir/n8n-credentials.before.txt" || die 'credential baseline is missing'
test -s "$evidence_dir/n8n-credentials.after.txt" || die 'post-import credential evidence is missing'
test -s "$evidence_dir/n8n-audit.txt" || die 'n8n audit evidence is missing'
test "$(cat "$evidence_dir/runtime-authentication.txt")" = AUTHENTICATED || die 'runtime authentication proof is missing'

test "$(latest_migration)" = "$TARGET_MIGRATION" || die 'target migration is not applied'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code='$WORKFLOW_REGISTRY_CODE' AND runtime_state='imported_inactive' AND trigger_state='disabled' AND runtime_evidence='$TANAGHOM_RELEASE_ID-inactive-zero-execution';")" = 1 || die 'worker registry state is invalid'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE runtime_state='active';")" = 0 || die 'a registry workflow unexpectedly reports active'
test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations were created'
test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'a provider emergency stop is inactive'
assert_runtime_role_least_privilege
assert_credential_encrypted
assert_workflow_inactive
assert_existing_workflows_unchanged "$evidence_dir/n8n-workflows.before.json" "$evidence_dir/n8n-workflows.after.json"
assert_existing_credentials_unchanged "$evidence_dir/n8n-credentials.before.txt" "$evidence_dir/n8n-credentials.after.txt"

assert_protected_units_active
assert_protected_containers_healthy
assert_protected_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_production_worktree_unchanged "$evidence_dir/production-worktree.before"
current_firewall=$(mktemp)
capture_firewall_boundary "$current_firewall"
cmp -s "$evidence_dir/firewall.before" "$current_firewall" || die 'package-owned firewall state changed'
rm -f "$current_firewall"
sha256sum -c "$evidence_dir/nginx.before.sha256" >/dev/null || die 'Tanaghom Nginx configuration changed'
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'dashboard is unhealthy'
assert_firewall_boundary
assert_public_boundary
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_CURRENT_COMMIT" || die 'production dashboard source changed'

echo 'PASS: migration 0024, least-privilege credential, and one inactive zero-execution worker validated without provider or protected-service changes.'
