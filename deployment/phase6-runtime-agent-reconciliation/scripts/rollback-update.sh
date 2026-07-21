#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_runtime_agent_environment
test "${TANAGHOM_RUNTIME_AGENT_ROLLBACK_AUTHORIZATION:-}" = 'ROLLBACK-THE-AUTHORIZED-RUNTIME-AGENT-RELEASE' || die 'explicit runtime-agent rollback authorization is absent'
evidence="/var/backups/tanaghom-$TANAGHOM_RUNTIME_AGENT_RELEASE_ID"
test -s "$evidence/release.env" || die 'release evidence is missing'
grep -q '^COMMITTED_AT=' "$evidence/release.env" || die 'release never committed'
test ! -e "$evidence/rollback-complete" || die 'release was already rolled back'
assert_database_at_target_runtime_agents
assert_new_agents_unused
assert_protected_container_ids_unchanged "$evidence/protected-container-ids.before"
assert_dashboard_id_unchanged "$evidence/dashboard-container-id.before"
assert_production_worktree_unchanged "$evidence/production-worktree.before"
db_file "$MIGRATION_DOWN" >/dev/null
test "$(latest_migration)" = "$EXPECTED_START_MIGRATION" || die 'rollback did not reach migration 0024'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agents WHERE code IN ('publisher_monitor','sales_crm') OR id IN ('$PUBLISHER_ID','$SALES_ID');")" = 0 || die 'unused package-owned agent rows were not removed'
capture_agents "$evidence/agents.rollback.txt"
cmp -s "$evidence/agents.before.txt" "$evidence/agents.rollback.txt" || die 'agent inventory was not restored'
assert_protected_units_active
assert_protected_containers_healthy
assert_firewall_boundary
assert_public_boundary
printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$evidence/rollback-complete"
chmod 0600 "$evidence/rollback-complete" "$evidence/agents.rollback.txt"
echo 'PASS: unused runtime-agent reconciliation rolled back exactly to migration 0024.'
