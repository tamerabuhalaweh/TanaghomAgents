#!/bin/sh
set -eu

CANARY_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$CANARY_SCRIPT_DIR/../../.." && pwd)}
WORKER_COMMON_DIR="$RELEASE_SOURCE_ROOT/deployment/phase5c-conversation-worker-production-update/scripts"
TANAGHOM_WORKER_COMMON_DIR=$WORKER_COMMON_DIR
export TANAGHOM_WORKER_COMMON_DIR
. "$WORKER_COMMON_DIR/common.sh"
unset TANAGHOM_WORKER_COMMON_DIR

SCRIPT_DIR=$CANARY_SCRIPT_DIR
PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
EXPECTED_MIGRATION=0025_runtime_agent_reconciliation
WORKFLOW_ID=phase5ConversationIntelligenceV1
WORKFLOW_REGISTRY_CODE=conversation_intelligence_worker
WORKFLOW_SOURCE="$RELEASE_SOURCE_ROOT/n8n/workflows/phase5/conversation-intelligence.v1.json"
N8N_MAIN_CONTAINER=smartlabs-n8n-n8n-1
N8N_DATABASE_CONTAINER=smartlabs-n8n-postgres-1
N8N_EXPECTED_VERSION=2.26.8
DATABASE_CA_CERT=${TANAGHOM_DATABASE_CA_CERT:-$RELEASE_SOURCE_ROOT/deployment/phase3-shadow-canary/certificates/supabase-root-2021-ca.pem}

require_canary_environment() {
  test "${TANAGHOM_CONVERSATION_CANARY_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' || die 'explicit Conversation Intelligence canary authorization is absent'
  case "${TANAGHOM_CONVERSATION_CANARY_ID:-}" in
    conversationcanary-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_CONVERSATION_CANARY_ID must use conversationcanary-YYYYMMDDTHHMMSSZ' ;;
  esac
  for value in "${TANAGHOM_EXPECTED_PRODUCTION_COMMIT:-}" "${TANAGHOM_CONVERSATION_CANARY_SOURCE_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' || die 'production and source commits must be full lowercase Git SHAs'
  done
}

db_exec() {
  url=$(database_url)
  PGAPPNAME=tanaghom-conversation-canary psql "$url" -X -v ON_ERROR_STOP=1 -c "$1" >/dev/null
  unset url
}

workflow_count() { n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$WORKFLOW_ID';"; }
workflow_active() { n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$WORKFLOW_ID' AND active IS TRUE AND \"isArchived\" IS FALSE;"; }
workflow_execution_count() { n8n_db_scalar "SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$WORKFLOW_ID';"; }

assert_workflow_inactive() {
  test "$(workflow_count)" = 1 || die 'Conversation Intelligence workflow is missing or duplicated'
  test "$(workflow_active)" = 0 || die 'Conversation Intelligence workflow is active'
}

export_all_workflows() {
  destination=$1
  remote="/home/node/tanaghom-conversation-canary-export-$$.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n export:workflow --all --pretty --output="$remote" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" test -s "$remote"
  docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
}

import_workflow_inactive() {
  source=$1
  label=$2
  remote="/home/node/tanaghom-$TANAGHOM_CONVERSATION_CANARY_ID-$label-$$.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec 'umask 077; cat > "$1"' sh "$remote" < "$source"
  docker exec -u node "$N8N_MAIN_CONTAINER" test -r "$remote"
  status=0
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$remote" --activeState=false >/dev/null || status=$?
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  return "$status"
}

publish_workflow() { docker exec -u node "$N8N_MAIN_CONTAINER" n8n publish:workflow --id="$WORKFLOW_ID" >/dev/null; }
unpublish_workflow() { docker exec -u node "$N8N_MAIN_CONTAINER" n8n unpublish:workflow --id="$WORKFLOW_ID" >/dev/null 2>&1 || true; }
execute_workflow_once() { docker exec -u node "$N8N_MAIN_CONTAINER" n8n execute --id="$WORKFLOW_ID" --rawOutput; }

assert_conversation_baseline() {
  test "$(latest_migration)" = "$EXPECTED_MIGRATION" || die "database is not at $EXPECTED_MIGRATION"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.integration_connections WHERE provider='ghl' AND status='connected';")" = 0 || die 'a connected GHL integration already exists'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type='conversation.ghl.inbound_event' AND status IN ('queued','running');")" = 0 || die 'open Conversation Intelligence work already exists'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.ghl_inbound_events WHERE status IN ('pending','processing');")" = 0 || die 'an open GHL inbound event already exists'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode<>'manual' OR action_emergency_stop IS NOT TRUE OR proactive_message_mode<>'disabled';")" = 0 || die 'an organization CRM policy is unlocked'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE provider='ghl' AND emergency_stop IS TRUE;")" = 1 || die 'the global GHL emergency stop is inactive'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.conversation_dependency_cooldowns WHERE blocked_until>statement_timestamp();")" = 0 || die 'an active conversation dependency cooldown exists'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code='$WORKFLOW_REGISTRY_CODE' AND runtime_state='imported_inactive' AND trigger_state='disabled';")" = 1 || die 'Conversation Intelligence registry is not inactive/disabled'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agents WHERE code='sales_crm' AND status='idle';")" = 1 || die 'Sales & CRM agent is not idle'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations already exist'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.ghl_action_jobs;")" = 0 || die 'GHL action jobs already exist'
}

capture_canary_counts() {
  destination=$1
  {
    echo "workflow_executions=$(workflow_execution_count)"
    echo "external_operations=$(db_scalar 'SELECT count(*) FROM tanaghom.external_operations;')"
    echo "ghl_action_jobs=$(db_scalar 'SELECT count(*) FROM tanaghom.ghl_action_jobs;')"
    echo "posts=$(db_scalar 'SELECT count(*) FROM tanaghom.posts;')"
    echo "leads=$(db_scalar 'SELECT count(*) FROM tanaghom.leads;')"
    echo "outbox_events=$(db_scalar 'SELECT count(*) FROM tanaghom.outbox_events;')"
  } > "$destination"
  chmod 0600 "$destination"
}

count_value() {
  file=$1
  key=$2
  awk -F= -v wanted="$key" '$1==wanted {print substr($0,index($0,"=")+1); found=1} END {if(!found) exit 1}' "$file"
}

assert_counts_unchanged_except_execution() {
  before=$1
  after=$2
  test "$(count_value "$after" workflow_executions)" -eq "$(( $(count_value "$before" workflow_executions) + 1 ))" || die 'Conversation Intelligence execution delta is not exactly one'
  for key in external_operations ghl_action_jobs posts leads outbox_events; do
    test "$(count_value "$before" "$key")" = "$(count_value "$after" "$key")" || die "$key count changed during the canary"
  done
}

operator() {
  test -s "$DATABASE_CA_CERT" || die "reviewed database CA certificate is missing: $DATABASE_CA_CERT"
  DATABASE_URL=$(database_url) NODE_EXTRA_CA_CERTS="$DATABASE_CA_CERT" TANAGHOM_DATABASE_SSL_MODE=verify-full \
    node "$SCRIPT_DIR/canary-operator.mjs" "$@"
}

restore_registry_inactive() {
  test "$(db_scalar "WITH updated AS (UPDATE tanaghom.agent_workflow_registry SET runtime_state='imported_inactive',trigger_state='disabled',runtime_verified_at=statement_timestamp(),runtime_evidence='$TANAGHOM_CONVERSATION_CANARY_ID-restored-inactive' WHERE code='$WORKFLOW_REGISTRY_CODE' RETURNING 1) SELECT count(*) FROM updated;")" = 1 || die 'Conversation Intelligence registry could not be restored inactive'
}
