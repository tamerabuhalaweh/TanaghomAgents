#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_environment
for command in docker git jq node psql curl iptables systemctl sha256sum openssl; do command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"; done
test "$(git -C "$PRODUCTION_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_PRODUCTION_COMMIT" || die 'production dashboard commit differs from the approved baseline'
test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_CANARY_SOURCE_COMMIT" || die 'canary package checkout differs from the approved source commit'
test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --porcelain --untracked-files=no)" || die 'canary package checkout has tracked modifications'
test "$(docker exec -u node "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" || die 'unexpected n8n version'
test -s "$WORKFLOW_CONTRACT" || die 'reviewed workflow contract helper is missing'
assert_business_locks
assert_protected_health
assert_public_boundary
assert_firewall_boundary
assert_workflow_inactive "$STRATEGIST_ID"
assert_workflow_inactive "$PRODUCER_ID"
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code IN ('$STRATEGIST_REGISTRY','$PRODUCER_REGISTRY') AND runtime_state='imported_inactive' AND trigger_state='workflow_inactive_only';")" = 2 || die 'core agent registry is not at the inactive baseline'
test -s "$DATABASE_CA_CERT" || die 'reviewed database CA certificate is missing'
openssl x509 -in "$DATABASE_CA_CERT" -noout >/dev/null 2>&1 || die 'reviewed database CA certificate is invalid'
operator check-database "$TANAGHOM_CANARY_CAMPAIGN_ID" "$TANAGHOM_CANARY_STRATEGY_JOB_ID" "$TANAGHOM_CANARY_CAMPAIGN" "$TANAGHOM_EXPECTED_CONTENT_ITEMS" >/dev/null
operator verify-authorized "$TANAGHOM_CANARY_CAMPAIGN_ID" "$TANAGHOM_CANARY_STRATEGY_JOB_ID" "$TANAGHOM_CANARY_CAMPAIGN" "$TANAGHOM_EXPECTED_CONTENT_ITEMS" >/dev/null

temporary=$(mktemp -d); trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
export_all_workflows "$temporary/before.json"
node "$WORKFLOW_CONTRACT" prepare "$temporary/before.json" "$RELEASE_SOURCE_ROOT/n8n/workflows/phase3" "$temporary/prepared"
echo 'PASS: the exact existing campaign and strategy job are ready for the controlled two-workflow canary; no state was changed.'
