#!/bin/sh
set -eu

HOTFIX_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$HOTFIX_SCRIPT_DIR/../../.." && pwd)}
CANARY_COMMON_DIR="$RELEASE_SOURCE_ROOT/deployment/phase6-conversation-shadow-canary/scripts"
. "$CANARY_COMMON_DIR/common.sh"

SCRIPT_DIR=$HOTFIX_SCRIPT_DIR
PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
TARGET_WORKFLOW_SOURCE="$RELEASE_SOURCE_ROOT/n8n/workflows/phase5/conversation-intelligence.v1.json"
EXPECTED_OLD_OPERATIONAL_SHA=dd445009e3527c7763bd5037ebda5048dd3bc815b38fb58e67c7ef98951311dd

require_hotfix_environment() {
  test "${TANAGHOM_CONVERSATION_HOTFIX_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' || die 'explicit Conversation Intelligence hotfix authorization is absent'
  case "${TANAGHOM_CONVERSATION_HOTFIX_ID:-}" in
    conversation-schema-hotfix-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_CONVERSATION_HOTFIX_ID must use conversation-schema-hotfix-YYYYMMDDTHHMMSSZ' ;;
  esac
  for value in "${TANAGHOM_EXPECTED_PRODUCTION_COMMIT:-}" "${TANAGHOM_CONVERSATION_HOTFIX_SOURCE_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' || die 'production and source commits must be full lowercase Git SHAs'
  done
  TANAGHOM_RELEASE_ID=$TANAGHOM_CONVERSATION_HOTFIX_ID
  export TANAGHOM_RELEASE_ID
}

import_hotfix_workflow_inactive() {
  source=$1
  label=$2
  remote="/home/node/tanaghom-$TANAGHOM_CONVERSATION_HOTFIX_ID-$label-$$.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec 'umask 077; cat > "$1"' sh "$remote" < "$source"
  docker exec -u node "$N8N_MAIN_CONTAINER" test -r "$remote"
  status=0
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$remote" --activeState=false >/dev/null || status=$?
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  return "$status"
}

active_workflow_count() {
  n8n_db_scalar 'SELECT count(*) FROM workflow_entity WHERE active IS TRUE AND "isArchived" IS FALSE;'
}

capture_dashboard_id() {
  docker inspect -f '{{.Id}}' tanaghom-dashboard-canary-dashboard-1 > "$1"
  chmod 0600 "$1"
}

assert_dashboard_id_unchanged() {
  test "$(cat "$1")" = "$(docker inspect -f '{{.Id}}' tanaghom-dashboard-canary-dashboard-1)" || die 'Tanaghom dashboard container was recreated'
}

assert_hotfix_database_boundary() {
  test "$(latest_migration)" = 0025_runtime_agent_reconciliation || die 'database is not at migration 0025'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations exist'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'a provider emergency stop is inactive'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agents WHERE code='sales_crm' AND status='idle';")" = 1 || die 'Sales & CRM agent is not idle'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code='$WORKFLOW_REGISTRY_CODE' AND runtime_state='imported_inactive' AND trigger_state='disabled';")" = 1 || die 'Conversation Intelligence registry is not inactive/disabled'
}
