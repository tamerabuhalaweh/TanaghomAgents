#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_canary_environment
for command in docker git jq node psql curl iptables systemctl sha256sum openssl; do
  command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"
done

test -d "$RELEASE_SOURCE_ROOT/.git" || die 'reviewed release-source checkout is missing'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_CONVERSATION_CANARY_SOURCE_COMMIT" || die 'release-source checkout is not at the authorized canary commit'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain --untracked-files=no)" || die 'release-source checkout has tracked modifications'
test -d "$PRODUCTION_ROOT/.git" || die 'production dashboard checkout is missing'
test "$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" || die 'production dashboard commit differs from the approved baseline'
assert_production_worktree_reviewed
test "$(docker exec -u node "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" || die 'unexpected n8n version'

assert_conversation_baseline
assert_workflow_inactive
test "$(workflow_execution_count)" = 0 || die 'Conversation Intelligence has prior execution history'
test "$(n8n_db_scalar "SELECT count(*) FROM credentials_entity WHERE id='62000000-0000-4000-8000-000000000005' AND type='postgres';")" = 1 || die 'restricted Conversation Intelligence database credential is unavailable'
test "$(n8n_db_scalar "SELECT count(*) FROM credentials_entity WHERE id='62000000-0000-4000-8000-000000000002' AND type='httpHeaderAuth';")" = 1 || die 'reviewed Gemma credential is unavailable'
test "$(db_scalar "SELECT pg_has_role('tanaghom_conversation_runtime','tanaghom_conversation_worker','MEMBER');")" = t || die 'restricted Conversation Intelligence runtime role is unavailable'
test "$(db_scalar "SELECT pg_has_role('tanaghom_conversation_runtime','tanaghom_n8n_worker','MEMBER');")" = f || die 'Conversation Intelligence runtime inherited the general worker role'

assert_protected_units_active
assert_protected_containers_healthy
test "$(container_health tanaghom-dashboard-canary-dashboard-1)" = healthy || die 'Tanaghom dashboard container is not healthy'
assert_public_boundary
assert_firewall_boundary
test -s "$DATABASE_CA_CERT" || die 'reviewed database CA certificate is missing'
openssl x509 -in "$DATABASE_CA_CERT" -noout >/dev/null 2>&1 || die 'reviewed database CA certificate is invalid'
operator check-database "$TANAGHOM_CONVERSATION_CANARY_ID" >/dev/null

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
export_all_workflows "$temporary/workflows.json"
node "$SCRIPT_DIR/workflow-contract.mjs" prepare "$temporary/workflows.json" "$WORKFLOW_SOURCE" "$temporary"
echo 'PASS: production is ready for the one-execution Conversation Intelligence shadow canary; no state was changed.'
