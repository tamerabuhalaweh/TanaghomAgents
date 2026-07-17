#!/bin/sh
set -eu

SCRIPT_DIR_COMMON=${TANAGHOM_SHADOW_COMMON_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}
. "$SCRIPT_DIR_COMMON/../../phase5g-production-update/scripts/common.sh"

EXPECTED_START_MIGRATION=0020_quality_rollout_control
TARGET_MIGRATION=0021_quality_baseline_shadow_pipeline
PENDING_MIGRATIONS='0021_quality_baseline_shadow_pipeline'
WORKFLOW_ID=phase5gQualityShadowEvaluatorV1
WORKFLOW_NAME='Tanaghom — Quality Shadow Evaluator v1'
WORKFLOW_SOURCE="$RELEASE_SOURCE_ROOT/n8n/workflows/phase5g/quality-shadow-evaluator.v1.json"
N8N_MAIN_CONTAINER=smartlabs-n8n-n8n-1
N8N_DATABASE_CONTAINER=smartlabs-n8n-postgres-1
N8N_EXPECTED_VERSION=2.26.8

assert_database_at_start() {
  test "$(latest_migration)" = "$EXPECTED_START_MIGRATION" || die "unexpected migration ledger; expected $EXPECTED_START_MIGRATION"
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 || die 'a provider emergency stop is inactive'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode <> 'manual';")" = 0 || die 'Postiz organization mode is not manual'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode <> 'manual' OR conversation_processing_mode <> 'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode <> 'manual' OR proactive_message_mode <> 'disabled' OR action_emergency_stop IS NOT TRUE;")" = 0 || die 'CRM, conversation, or GHL action policy is not locked'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 || die 'external operations exist'
  test "$(db_scalar "SELECT (SELECT count(*) FROM tanaghom.quality_evaluation_snapshots)+(SELECT count(*) FROM tanaghom.quality_rollout_decisions);")" = 0 || die 'quality evidence or decisions already exist'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.quality_rollout_policies WHERE current_stage<>'baseline';")" = 0 || die 'an organization has left the quality baseline'
}

assert_quality_pipeline_safe_to_drop() {
  assert_quality_tables_safe_to_drop
  test "$(db_scalar "SELECT CASE WHEN to_regclass('tanaghom.quality_metric_program_versions') IS NULL THEN 0 ELSE (SELECT count(*) FROM tanaghom.quality_metric_program_versions) END;")" = 0 || die 'metric-program evidence exists; automatic schema rollback is unsafe'
  test "$(db_scalar "SELECT CASE WHEN to_regclass('tanaghom.quality_evaluation_datasets') IS NULL THEN 0 ELSE (SELECT count(*) FROM tanaghom.quality_evaluation_datasets) END;")" = 0 || die 'baseline or shadow dataset evidence exists; automatic schema rollback is unsafe'
}

n8n_db_scalar() {
  docker exec "$N8N_DATABASE_CONTAINER" sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"' sh "$1"
}

n8n_db_exec() {
  docker exec "$N8N_DATABASE_CONTAINER" sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$1" >/dev/null
}

workflow_count() {
  n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$WORKFLOW_ID';"
}

workflow_execution_count() {
  n8n_db_scalar "SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$WORKFLOW_ID';"
}

assert_workflow_absent() {
  test "$(workflow_count)" = 0 || die 'quality shadow workflow already exists'
  test "$(workflow_execution_count)" = 0 || die 'quality shadow workflow execution history already exists'
}

assert_workflow_inactive() {
  test "$(workflow_count)" = 1 || die 'quality shadow workflow is missing or duplicated'
  test "$(n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$WORKFLOW_ID' AND name='$WORKFLOW_NAME' AND active IS FALSE AND \"isArchived\" IS FALSE;")" = 1 || die 'quality shadow workflow identity or inactive state is invalid'
  test "$(workflow_execution_count)" = 0 || die 'quality shadow workflow unexpectedly executed'
}

validate_workflow_source() {
  command -v jq >/dev/null 2>&1 || die 'jq is required for exact workflow validation'
  test -s "$WORKFLOW_SOURCE" || die 'reviewed quality shadow workflow export is missing'
  jq -e --arg id "$WORKFLOW_ID" --arg name "$WORKFLOW_NAME" '
    .id==$id and .name==$name and .active==false and
    ([.nodes[] | select(.type=="n8n-nodes-base.scheduleTrigger" and .disabled==true)] | length)==1 and
    ([.nodes[] | select(.type=="n8n-nodes-base.httpRequest" and .name=="Call Gemma" and .parameters.url=="https://api.thesmartlabs.net/gemma4/v1/chat/completions")] | length)==1 and
    ([.nodes[] | select(.type=="n8n-nodes-base.executeCommand" or .type=="n8n-nodes-base.readWriteFile" or .type=="n8n-nodes-base.ssh")] | length)==0
  ' "$WORKFLOW_SOURCE" >/dev/null || die 'reviewed workflow is not inactive, disabled, and boundary-constrained'
  test "$(jq -r '[.nodes[] | select(.credentials.postgres.id=="62000000-0000-4000-8000-000000000001")] | length' "$WORKFLOW_SOURCE")" -ge 1 || die 'restricted PostgreSQL credential binding is absent'
  test "$(jq -r '[.nodes[] | select(.credentials.httpHeaderAuth.id=="62000000-0000-4000-8000-000000000002")] | length' "$WORKFLOW_SOURCE")" = 1 || die 'reviewed Gemma credential binding is absent or duplicated'
}

export_all_workflows() {
  destination=$1
  remote="/home/node/tanaghom-workflows-$TANAGHOM_RELEASE_ID-$$.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  if ! docker exec -u node "$N8N_MAIN_CONTAINER" n8n export:workflow --all --pretty --output="$remote" >/dev/null; then
    docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
    return 1
  fi
  if ! docker exec -u node "$N8N_MAIN_CONTAINER" test -s "$remote"; then
    docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
    return 1
  fi
  if ! docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null; then
    docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
    return 1
  fi
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
  test -s "$destination"
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

delete_quality_workflow() {
  test "$(workflow_count)" = 1 || die 'quality shadow workflow deletion requires exactly one row'
  test "$(workflow_execution_count)" = 0 || die 'quality shadow workflow has executions and cannot be automatically deleted'
  test "$(n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$WORKFLOW_ID' AND active IS FALSE;")" = 1 || die 'quality shadow workflow is active and cannot be automatically deleted'
  n8n_db_exec "BEGIN; DELETE FROM workflow_entity WHERE id='$WORKFLOW_ID' AND active IS FALSE; COMMIT;"
  assert_workflow_absent
}
