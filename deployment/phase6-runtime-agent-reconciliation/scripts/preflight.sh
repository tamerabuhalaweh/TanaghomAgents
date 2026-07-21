#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_runtime_agent_environment
for command in docker git jq psql curl iptables systemctl sha256sum; do command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"; done
test -d "$RELEASE_SOURCE_ROOT/.git" || die 'reviewed release-source checkout is missing'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain --untracked-files=no)" || die 'release-source checkout has tracked modifications'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_RUNTIME_AGENT_SOURCE_COMMIT" || die 'release-source checkout is not at the authorized commit'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" || die 'production dashboard commit differs from the approved baseline'
assert_production_worktree_reviewed
remote_target=$(git -C "$RELEASE_SOURCE_ROOT" ls-remote origin refs/heads/main | awk '{print $1}')
test "$remote_target" = "$TANAGHOM_RUNTIME_AGENT_SOURCE_COMMIT" || die 'authorized source commit is not current remote main'
test -s "$MIGRATION_UP" && test -s "$MIGRATION_DOWN" || die 'runtime-agent migration pair is missing'
available_gib=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
test "$available_gib" -ge 10 || die 'less than 10 GiB is available on the root filesystem'
assert_database_at_start_runtime_agents
assert_protected_units_active
assert_protected_containers_healthy
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'Tanaghom dashboard is unhealthy'
assert_firewall_boundary
assert_public_boundary
echo 'PASS: production is ready for the database-only runtime-agent reconciliation; no state was changed.'
