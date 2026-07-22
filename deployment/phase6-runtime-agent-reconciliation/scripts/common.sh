#!/bin/sh
set -eu

RUNTIME_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$RUNTIME_SCRIPT_DIR/../../.." && pwd)}
WORKER_COMMON_DIR="$RELEASE_SOURCE_ROOT/deployment/phase5c-conversation-worker-production-update/scripts"
TANAGHOM_WORKER_COMMON_DIR=$WORKER_COMMON_DIR
export TANAGHOM_WORKER_COMMON_DIR
. "$WORKER_COMMON_DIR/common.sh"
unset TANAGHOM_WORKER_COMMON_DIR

SCRIPT_DIR=$RUNTIME_SCRIPT_DIR
EXPECTED_START_MIGRATION=0024_conversation_intelligence_worker_registry
TARGET_MIGRATION=0025_runtime_agent_reconciliation
MIGRATION_UP="$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.up.sql"
MIGRATION_DOWN="$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql"
PUBLISHER_ID=10000000-0000-4000-8000-000000000003
SALES_ID=10000000-0000-4000-8000-000000000004

require_runtime_agent_environment() {
  test "${TANAGHOM_RUNTIME_AGENT_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' || die 'explicit runtime-agent authorization is absent'
  case "${TANAGHOM_RUNTIME_AGENT_RELEASE_ID:-}" in
    phase6-runtime-agents-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_RUNTIME_AGENT_RELEASE_ID must use phase6-runtime-agents-YYYYMMDDTHHMMSSZ' ;;
  esac
  TANAGHOM_RELEASE_ID=$TANAGHOM_RUNTIME_AGENT_RELEASE_ID
  export TANAGHOM_RELEASE_ID
  for value in "${TANAGHOM_EXPECTED_PRODUCTION_COMMIT:-}" "${TANAGHOM_RUNTIME_AGENT_SOURCE_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' || die 'production and source commits must be full lowercase Git SHAs'
  done
}

capture_agents() {
  destination=$1
  db_scalar "SELECT id||'|'||code||'|'||name||'|'||description||'|'||status FROM tanaghom.agents ORDER BY code,id;" > "$destination"
  chmod 0600 "$destination"
}

assert_database_at_start_runtime_agents() {
  test "$(latest_migration)" = "$EXPECTED_START_MIGRATION" || die "database is not at $EXPECTED_START_MIGRATION"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agents WHERE code IN ('campaign_strategist','content_producer');")" = 2 || die 'the two existing core runtime agents are not exact'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agents WHERE code IN ('publisher_monitor','sales_crm') OR id IN ('$PUBLISHER_ID','$SALES_ID');")" = 0 || die 'a target runtime agent code or identity already exists'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'a provider emergency stop is inactive'
  test "$(db_scalar 'SELECT count(*) FROM tanaghom.external_operations;')" = 0 || die 'external operations already exist'
}

assert_database_at_target_runtime_agents() {
  test "$(latest_migration)" = "$TARGET_MIGRATION" || die "database is not at $TARGET_MIGRATION"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agents WHERE code IN ('campaign_strategist','content_producer','publisher_monitor','sales_crm');")" = 4 || die 'four business runtime agents are not present'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agents WHERE id='$PUBLISHER_ID' AND code='publisher_monitor' AND name='Publisher & Performance Monitor' AND status='idle';")" = 1 || die 'Publisher runtime agent is not exact'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agents WHERE id='$SALES_ID' AND code='sales_crm' AND name='Sales & CRM Agent' AND status='idle';")" = 1 || die 'Sales runtime agent is not exact'
}

assert_prior_agents_unchanged() {
  before=$1
  after=$2
  filtered=$(mktemp)
  grep -v -E "^($PUBLISHER_ID|$SALES_ID)\|" "$after" > "$filtered" || true
  cmp -s "$before" "$filtered" || { rm -f "$filtered"; die 'an existing runtime agent changed'; }
  rm -f "$filtered"
}

assert_new_agents_unused() {
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE agent_id IN ('$PUBLISHER_ID','$SALES_ID');")" = 0 || die 'a reconciled runtime agent has job history; rollback is unsafe'
}

capture_dashboard_id() {
  docker inspect -f '{{.Id}}' tanaghom-dashboard-canary-dashboard-1 > "$1"
  chmod 0600 "$1"
}

assert_dashboard_id_unchanged() {
  test "$(cat "$1")" = "$(docker inspect -f '{{.Id}}' tanaghom-dashboard-canary-dashboard-1)" || die 'Tanaghom dashboard container was recreated'
}
