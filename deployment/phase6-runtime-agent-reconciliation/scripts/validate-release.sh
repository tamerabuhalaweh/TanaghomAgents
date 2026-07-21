#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_runtime_agent_environment
evidence="/var/backups/tanaghom-$TANAGHOM_RUNTIME_AGENT_RELEASE_ID"
test -d "$evidence" || die 'release evidence directory is missing'
assert_database_at_target_runtime_agents
capture_agents "$evidence/agents.after.txt"
assert_prior_agents_unchanged "$evidence/agents.before.txt" "$evidence/agents.after.txt"
test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'a provider emergency stop changed'
test "$(db_scalar 'SELECT count(*) FROM tanaghom.external_operations;')" = 0 || die 'external operations changed'
export_all_workflows "$evidence/n8n-workflows.after.json"
capture_credential_inventory "$evidence/n8n-credentials.after.txt"
cmp -s "$evidence/n8n-workflows.before.json" "$evidence/n8n-workflows.after.json" || die 'an n8n workflow changed'
cmp -s "$evidence/n8n-credentials.before.txt" "$evidence/n8n-credentials.after.txt" || die 'an n8n credential changed'
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit > "$evidence/n8n-audit.txt"
assert_protected_container_ids_unchanged "$evidence/protected-container-ids.before"
assert_dashboard_id_unchanged "$evidence/dashboard-container-id.before"
assert_production_worktree_unchanged "$evidence/production-worktree.before"
assert_protected_units_active
assert_protected_containers_healthy
assert_firewall_boundary
assert_public_boundary
capture_firewall_boundary "$evidence/firewall.after"
cmp -s "$evidence/firewall.before" "$evidence/firewall.after" || die 'firewall policy changed'
sha256sum -c "$evidence/nginx.before.sha256" >/dev/null || die 'Nginx configuration changed'
chmod 0600 "$evidence"/*
echo 'PASS: migration 0025 and exactly two additive runtime agents validated with all protected boundaries unchanged.'
