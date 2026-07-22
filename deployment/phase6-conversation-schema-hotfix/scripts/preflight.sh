#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_hotfix_environment
for command in docker git jq node psql curl iptables systemctl sha256sum; do command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"; done
test -d "$RELEASE_SOURCE_ROOT/.git" || die 'reviewed release-source checkout is missing'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain --untracked-files=no)" || die 'release-source checkout has tracked modifications'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_CONVERSATION_HOTFIX_SOURCE_COMMIT" || die 'release-source checkout is not at the authorized hotfix commit'
remote_target=$(git -C "$RELEASE_SOURCE_ROOT" ls-remote origin refs/heads/main | awk '{print $1}')
test "$remote_target" = "$TANAGHOM_CONVERSATION_HOTFIX_SOURCE_COMMIT" || die 'authorized hotfix source is not current remote main'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" || die 'production dashboard commit differs from the approved baseline'
assert_production_worktree_reviewed
test "$(docker exec -u node "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" || die 'unexpected n8n version'
test -s "$TARGET_WORKFLOW_SOURCE" || die 'reviewed target workflow is missing'
assert_hotfix_database_boundary
assert_workflow_inactive
test "$(workflow_execution_count)" = 0 || die 'Conversation Intelligence has stored execution history'
test "$(n8n_db_scalar "SELECT count(*) FROM credentials_entity WHERE id='62000000-0000-4000-8000-000000000005' AND type='postgres';")" = 1 || die 'restricted Conversation Intelligence database credential is unavailable'
test "$(n8n_db_scalar "SELECT count(*) FROM credentials_entity WHERE id='62000000-0000-4000-8000-000000000002' AND type='httpHeaderAuth';")" = 1 || die 'reviewed Gemma credential is unavailable'
assert_protected_units_active
assert_protected_containers_healthy
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'Tanaghom dashboard is unhealthy'
assert_public_boundary
assert_firewall_boundary
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
export_all_workflows "$temporary/workflows.json"
node "$SCRIPT_DIR/hotfix-contract.mjs" prepare "$temporary/workflows.json" "$TARGET_WORKFLOW_SOURCE" "$temporary" "$EXPECTED_OLD_OPERATIONAL_SHA"
echo 'PASS: production is ready for the inactive Conversation Intelligence grammar hotfix; no state was changed.'
