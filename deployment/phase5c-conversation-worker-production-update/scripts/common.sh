#!/bin/sh
set -eu

SCRIPT_DIR_WORKER=${TANAGHOM_WORKER_COMMON_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}
. "$SCRIPT_DIR_WORKER/../../phase5g-production-update/scripts/common.sh"

EXPECTED_START_MIGRATION=0023_campaign_lifecycle
TARGET_MIGRATION=0024_conversation_intelligence_worker_registry
WORKFLOW_ID=phase5ConversationIntelligenceV1
WORKFLOW_SOURCE="$RELEASE_SOURCE_ROOT/n8n/workflows/phase5/conversation-intelligence.v1.json"
WORKFLOW_REGISTRY_CODE=conversation_intelligence_worker
RUNTIME_ROLE=tanaghom_conversation_runtime
CREDENTIAL_ID=62000000-0000-4000-8000-000000000005
CREDENTIAL_NAME='Tanaghom Conversation PostgreSQL'
N8N_MAIN_CONTAINER=smartlabs-n8n-n8n-1
N8N_DATABASE_CONTAINER=smartlabs-n8n-postgres-1
N8N_EXPECTED_VERSION=2.26.8
REVIEWED_DIRTY_PATH=deployment/phase4-postiz-activation/egress/squid.conf
REVIEWED_DIRTY_DIFF_SHA256=94733679d940cc704f568fac6b488c4001638a39336ec843dd99306a64044c5d

require_release_environment() {
  test "${TANAGHOM_WORKER_RELEASE_AUTHORIZATION:-}" = 'YES-I-AM-THE-AUTHORIZED-OWNER' || die 'explicit owner authorization is absent'
  case "${TANAGHOM_WORKER_RELEASE_ID:-}" in
    phase5c-worker-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_WORKER_RELEASE_ID must use phase5c-worker-YYYYMMDDTHHMMSSZ' ;;
  esac
  TANAGHOM_RELEASE_ID=$TANAGHOM_WORKER_RELEASE_ID
  export TANAGHOM_RELEASE_ID
  for value in "${TANAGHOM_EXPECTED_CURRENT_COMMIT:-}" "${TANAGHOM_TARGET_COMMIT:-}"; do
    echo "$value" | grep -Eq '^[0-9a-f]{40}$' || die 'expected and target commits must be full lowercase Git SHAs'
  done
  test "$TANAGHOM_EXPECTED_CURRENT_COMMIT" != "$TANAGHOM_TARGET_COMMIT" || die 'current and target commits must differ'
}

assert_production_worktree_reviewed() {
  status=$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" status --porcelain=v1)
  test -n "$status" || return 0
  test "$status" = " M $REVIEWED_DIRTY_PATH" || die 'production checkout contains an unreviewed worktree change'
  actual=$(git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" diff --binary --no-ext-diff -- "$REVIEWED_DIRTY_PATH" | sha256sum | awk '{print $1}')
  test "$actual" = "$REVIEWED_DIRTY_DIFF_SHA256" || die 'reviewed operational worktree diff changed'
}

capture_production_worktree_state() {
  prefix=$1
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" status --porcelain=v1 > "$prefix.status"
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" diff --binary --no-ext-diff > "$prefix.diff"
  chmod 0600 "$prefix.status" "$prefix.diff"
}

assert_production_worktree_unchanged() {
  prefix=$1
  current_status=$(mktemp)
  current_diff=$(mktemp)
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" status --porcelain=v1 > "$current_status"
  git -C "$PRODUCTION_ROOT" -c safe.directory="$PRODUCTION_ROOT" diff --binary --no-ext-diff > "$current_diff"
  cmp -s "$prefix.status" "$current_status" || { rm -f "$current_status" "$current_diff"; die 'production worktree status changed'; }
  cmp -s "$prefix.diff" "$current_diff" || { rm -f "$current_status" "$current_diff"; die 'production worktree diff changed'; }
  rm -f "$current_status" "$current_diff"
}

n8n_db_scalar() {
  docker exec "$N8N_DATABASE_CONTAINER" sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"' sh "$1"
}

n8n_db_exec() {
  docker exec "$N8N_DATABASE_CONTAINER" sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$1" >/dev/null
}

workflow_count() { n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$WORKFLOW_ID';"; }
workflow_execution_count() { n8n_db_scalar "SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$WORKFLOW_ID';"; }
credential_count() { n8n_db_scalar "SELECT count(*) FROM credentials_entity WHERE id='$CREDENTIAL_ID';"; }
runtime_role_count() { db_scalar "SELECT count(*) FROM pg_roles WHERE rolname='$RUNTIME_ROLE';"; }

assert_workflow_absent() {
  test "$(workflow_count)" = 0 || die 'Conversation Intelligence workflow already exists'
  test "$(workflow_execution_count)" = 0 || die 'Conversation Intelligence execution history already exists'
}

assert_workflow_inactive() {
  test "$(workflow_count)" = 1 || die 'Conversation Intelligence workflow is missing or duplicated'
  test "$(n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$WORKFLOW_ID' AND active IS FALSE AND \"isArchived\" IS FALSE;")" = 1 || die 'Conversation Intelligence workflow is not inactive'
  test "$(workflow_execution_count)" = 0 || die 'Conversation Intelligence workflow unexpectedly executed'
}

assert_credential_absent() { test "$(credential_count)" = 0 || die 'Conversation Intelligence credential already exists'; }

assert_credential_encrypted() {
  test "$(credential_count)" = 1 || die 'Conversation Intelligence credential is missing or duplicated'
  test "$(n8n_db_scalar "SELECT count(*) FROM credentials_entity WHERE id='$CREDENTIAL_ID' AND name='$CREDENTIAL_NAME' AND type='postgres' AND length(data)>40;")" = 1 || die 'Conversation Intelligence credential metadata is invalid'
}

validate_workflow_source() {
  command -v jq >/dev/null 2>&1 || die 'jq is required'
  test -s "$WORKFLOW_SOURCE" || die 'reviewed workflow export is missing'
  jq -e --arg id "$WORKFLOW_ID" '
    .id==$id and .active==false and
    ([.nodes[] | select(.type=="n8n-nodes-base.scheduleTrigger" and .disabled==true)] | length)==1 and
    ([.nodes[] | select(.type=="n8n-nodes-base.httpRequest" and .name=="Call Gemma" and .parameters.url=="https://api.thesmartlabs.net/gemma4/v1/chat/completions")] | length)==1 and
    ([.nodes[] | select(.type=="n8n-nodes-base.executeCommand" or .type=="n8n-nodes-base.readWriteFile" or .type=="n8n-nodes-base.ssh")] | length)==0 and
    ([.nodes[] | select(.credentials.postgres.id=="62000000-0000-4000-8000-000000000005")] | length)>=1 and
    ([.nodes[] | select(.credentials.httpHeaderAuth.id=="62000000-0000-4000-8000-000000000002")] | length)==1
  ' "$WORKFLOW_SOURCE" >/dev/null || die 'reviewed workflow is not inactive, disabled, and boundary constrained'
}

assert_database_at_start() {
  test "$(latest_migration)" = "$EXPECTED_START_MIGRATION" || die "unexpected migration ledger; expected $EXPECTED_START_MIGRATION"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'a provider emergency stop is inactive'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode<>'manual' OR action_emergency_stop IS NOT TRUE;")" = 0 || die 'conversation or action policy is not locked'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code='$WORKFLOW_REGISTRY_CODE';")" = 0 || die 'Conversation Intelligence registry row already exists'
  test "$(runtime_role_count)" = 0 || die 'Conversation Intelligence runtime role already exists'
}

assert_runtime_role_least_privilege() {
  test "$(runtime_role_count)" = 1 || die 'Conversation Intelligence runtime role is missing'
  test "$(db_scalar "SELECT pg_has_role('$RUNTIME_ROLE','tanaghom_conversation_worker','MEMBER');")" = t || die 'runtime role lacks the Conversation Intelligence capability role'
  test "$(db_scalar "SELECT pg_has_role('$RUNTIME_ROLE','tanaghom_n8n_worker','MEMBER');")" = f || die 'runtime role inherited the general n8n worker role'
  test "$(db_scalar "SELECT has_table_privilege('$RUNTIME_ROLE','tanaghom.ghl_inbound_events','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'runtime role has direct inbound-event table access'
  test "$(db_scalar "SELECT has_table_privilege('$RUNTIME_ROLE','tanaghom.conversation_intelligence_proposals','SELECT,INSERT,UPDATE,DELETE');")" = f || die 'runtime role has direct proposal table access'
  for signature in \
    'tanaghom.claim_ghl_inbound_event_job()' \
    'tanaghom.prepare_conversation_intelligence(uuid)' \
    'tanaghom.persist_conversation_intelligence_proposal(uuid,jsonb)' \
    'tanaghom.record_ghl_inbound_event_failure(uuid,text,text,integer)'; do
    test "$(db_scalar "SELECT has_function_privilege('$RUNTIME_ROLE','$signature','EXECUTE');")" = t || die "runtime role lacks controlled function: $signature"
  done
}

authenticate_runtime_role_with_retry() {
  pgpass_file=$1
  authentication_output=$2
  authentication_errors=$3
  authentication_attempts=$4
  max_attempts=${TANAGHOM_RUNTIME_AUTH_ATTEMPTS:-24}
  retry_delay=${TANAGHOM_RUNTIME_AUTH_RETRY_DELAY_SECONDS:-5}

  case "$max_attempts" in ''|*[!0-9]*) die 'runtime authentication attempt count must be numeric' ;; esac
  case "$retry_delay" in ''|*[!0-9]*) die 'runtime authentication retry delay must be numeric' ;; esac
  test "$max_attempts" -ge 1 && test "$max_attempts" -le 60 || die 'runtime authentication attempt count is outside 1..60'
  test "$retry_delay" -le 30 || die 'runtime authentication retry delay exceeds 30 seconds'

  : > "$authentication_output"
  : > "$authentication_errors"
  : > "$authentication_attempts"
  attempt=1
  while test "$attempt" -le "$max_attempts"; do
    sleep "$retry_delay"
    if PGPASSFILE="$pgpass_file" PGCONNECT_TIMEOUT=10 psql -X -v ON_ERROR_STOP=1 -At \
      -c "SELECT CASE WHEN current_user='$RUNTIME_ROLE' THEN 'AUTHENTICATED' ELSE 'WRONG_ROLE' END;" \
      > "$authentication_output" 2>> "$authentication_errors"; then
      if test "$(cat "$authentication_output")" = AUTHENTICATED; then
        printf '%s\n' "$attempt" > "$authentication_attempts"
        return 0
      fi
    fi
    attempt=$((attempt + 1))
  done
  printf '%s\n' "$max_attempts" > "$authentication_attempts"
  return 1
}

capture_credential_inventory() {
  destination=$1
  n8n_db_scalar "SELECT id||'|'||name||'|'||type FROM credentials_entity ORDER BY id;" > "$destination"
  chmod 0600 "$destination"
}

assert_existing_credentials_unchanged() {
  before=$1
  after=$2
  filtered=$(mktemp)
  grep -v "^$CREDENTIAL_ID|" "$after" > "$filtered" || true
  cmp -s "$before" "$filtered" || { rm -f "$filtered"; die 'an existing n8n credential changed'; }
  rm -f "$filtered"
}

export_all_workflows() {
  destination=$1
  remote="/home/node/tanaghom-worker-workflows-$TANAGHOM_RELEASE_ID-$$.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n export:workflow --all --pretty --output="$remote" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" test -s "$remote"
  docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
}

assert_existing_workflows_unchanged() {
  before=$1
  after=$2
  before_normalized=$(mktemp)
  after_normalized=$(mktemp)
  jq -S --arg id "$WORKFLOW_ID" 'map(select(.id != $id)) | sort_by(.id)' "$before" > "$before_normalized"
  jq -S --arg id "$WORKFLOW_ID" 'map(select(.id != $id)) | sort_by(.id)' "$after" > "$after_normalized"
  cmp -s "$before_normalized" "$after_normalized" || { rm -f "$before_normalized" "$after_normalized"; die 'an existing n8n workflow changed'; }
  rm -f "$before_normalized" "$after_normalized"
}

delete_conversation_workflow() {
  assert_workflow_inactive
  n8n_db_exec "BEGIN; DELETE FROM workflow_entity WHERE id='$WORKFLOW_ID' AND active IS FALSE; COMMIT;"
  assert_workflow_absent
}

delete_conversation_credential() {
  assert_credential_encrypted
  n8n_db_exec "BEGIN; DELETE FROM shared_credentials WHERE \"credentialsId\"='$CREDENTIAL_ID'; DELETE FROM credentials_entity WHERE id='$CREDENTIAL_ID'; COMMIT;"
  assert_credential_absent
}
