#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_SOURCE_ROOT=${TANAGHOM_RELEASE_SOURCE_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)}
PRODUCTION_ROOT=${TANAGHOM_PRODUCTION_ROOT:-/opt/tanaghom-dashboard}
DATABASE_SECRET="$PRODUCTION_ROOT/deployment/dashboard-canary/secrets/database_url"
PUBLIC_HOST=tanaghom.38-247-187-232.sslip.io
EXPECTED_MIGRATION=0025_runtime_agent_reconciliation
EXPECTED_PRODUCTION_COMMIT=a25a24d2cb4cb8a8f2a231fb1d25ed682bf5f341
REVIEWED_DIRTY_PATH=deployment/phase4-postiz-activation/egress/squid.conf
REVIEWED_DIRTY_DIFF_SHA256=94733679d940cc704f568fac6b488c4001638a39336ec843dd99306a64044c5d
N8N_EXPECTED_VERSION=2.26.8
N8N_MAIN_CONTAINER=smartlabs-n8n-n8n-1
N8N_WORKER_CONTAINER=smartlabs-n8n-n8n-worker-1
N8N_DATABASE_CONTAINER=smartlabs-n8n-postgres-1
N8N_REDIS_CONTAINER=smartlabs-n8n-redis-1
N8N_PROXY_CONTAINER=smartlabs-n8n-egress-proxy-1
N8N_CONTAINERS="$N8N_DATABASE_CONTAINER $N8N_REDIS_CONTAINER $N8N_PROXY_CONTAINER $N8N_MAIN_CONTAINER $N8N_WORKER_CONTAINER"
CORE_IDS='phase3StrategistV1 phase3ContentProducerV1'
CONTROLLED_IDS='phase4PostizDraftV1 phase4PostizPerformanceV1 phase5GhlContactUpsertV1 phase5ConversationIntelligenceV1 phase5GovernedGhlActionsV1 phase5gQualityShadowEvaluatorV1'
ALL_IDS="$CORE_IDS $CONTROLLED_IDS"
PREEXISTING_IDS='phase3StrategistV1 phase3ContentProducerV1 phase4PostizDraftV1 phase5ConversationIntelligenceV1 phase5gQualityShadowEvaluatorV1'
NEW_IDS='phase4PostizPerformanceV1 phase5GhlContactUpsertV1 phase5GovernedGhlActionsV1'
CORE_REGISTRY='campaign_strategy_generator campaign_content_generator'
CONTROLLED_REGISTRY='postiz_draft_publisher postiz_performance_monitor ghl_contact_sync conversation_intelligence_worker governed_ghl_actions quality_shadow_evaluator'
ALL_REGISTRY="$CORE_REGISTRY $CONTROLLED_REGISTRY"

die() { echo "ERROR: $*" >&2; exit 1; }
require_root() { test "$(id -u)" -eq 0 || die 'root access is required'; }

require_release_environment() {
  test "${TANAGHOM_UAT_ACTIVATION_AUTHORIZATION:-}" = 'ACTIVATE-REVIEWED-TANAGHOM-UAT-WORKERS' ||
    die 'explicit UAT activation authorization is absent'
  case "${TANAGHOM_UAT_ACTIVATION_ID:-}" in
    uatactivation-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_UAT_ACTIVATION_ID must use uatactivation-YYYYMMDDTHHMMSSZ' ;;
  esac
  echo "${TANAGHOM_EXPECTED_RELEASE_COMMIT:-}" | grep -Eq '^[0-9a-f]{40}$' ||
    die 'expected release commit must be a full lowercase Git SHA'
}

database_url() {
  test -s "$DATABASE_SECRET" || die 'dashboard database secret is missing'
  cat "$DATABASE_SECRET"
}

db_scalar() {
  url=$(database_url)
  PGAPPNAME=tanaghom-uat-activation psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"
  unset url
}

db_file() {
  url=$(database_url)
  PGAPPNAME=tanaghom-uat-activation psql "$url" -X -v ON_ERROR_STOP=1 -f "$1"
  unset url
}

n8n_db_scalar() {
  docker exec "$N8N_DATABASE_CONTAINER" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"' sh "$1"
}

n8n_db_exec() {
  docker exec "$N8N_DATABASE_CONTAINER" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$1" >/dev/null
}

latest_migration() {
  db_scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;"
}

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null
}

assert_n8n_healthy() {
  for container in $N8N_CONTAINERS; do
    test "$(container_health "$container")" = healthy || die "n8n container is not healthy: $container"
  done
}

wait_for_n8n_health() {
  attempt=0
  while :; do
    healthy=true
    for container in $N8N_CONTAINERS; do
      test "$(container_health "$container")" = healthy || healthy=false
    done
    test "$healthy" = true && return 0
    attempt=$((attempt + 1))
    test "$attempt" -lt 60 || die 'n8n containers did not return healthy'
    sleep 2
  done
}

capture_container_ids() {
  destination=$1
  : >"$destination"
  chmod 0600 "$destination"
  for container in $N8N_CONTAINERS; do
    docker inspect -f '{{.Name}}={{.Id}}' "$container" | sed 's#^/##' >>"$destination"
  done
}

assert_container_ids_unchanged() {
  expected=$1
  actual=$(mktemp)
  capture_container_ids "$actual"
  cmp -s "$expected" "$actual" || {
    rm -f "$actual"
    die 'an n8n container was recreated'
  }
  rm -f "$actual"
}

assert_public_boundary() {
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/login")" = 200 ||
    die 'public login is unhealthy'
  test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/operations")" = 401 ||
    die 'protected API boundary changed'
}

capture_production_worktree() {
  destination=$1
  {
    printf 'commit='
    git -C "$PRODUCTION_ROOT" rev-parse HEAD
    git -C "$PRODUCTION_ROOT" status --short
    printf 'reviewed_diff_sha256='
    git -C "$PRODUCTION_ROOT" diff --binary -- "$REVIEWED_DIRTY_PATH" | sha256sum | awk '{print $1}'
  } >"$destination"
  chmod 0600 "$destination"
}

assert_production_worktree_reviewed() {
  test "$(git -C "$PRODUCTION_ROOT" rev-parse HEAD)" = "$EXPECTED_PRODUCTION_COMMIT" ||
    die 'production dashboard commit changed'
  test "$(git -C "$PRODUCTION_ROOT" status --short)" = " M $REVIEWED_DIRTY_PATH" ||
    die 'production dashboard worktree differs from the reviewed one-file state'
  actual=$(git -C "$PRODUCTION_ROOT" diff --binary -- "$REVIEWED_DIRTY_PATH" | sha256sum | awk '{print $1}')
  test "$actual" = "$REVIEWED_DIRTY_DIFF_SHA256" || die 'reviewed Squid-only dirty diff changed'
}

assert_release_source() {
  test "$(git -C "$RELEASE_SOURCE_ROOT" rev-parse HEAD)" = "$TANAGHOM_EXPECTED_RELEASE_COMMIT" ||
    die 'release checkout is not at the expected commit'
  test -z "$(git -C "$RELEASE_SOURCE_ROOT" status --short)" || die 'release checkout is dirty'
}

workflow_count() {
  n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$1';"
}

workflow_active_count() {
  n8n_db_scalar "SELECT count(*) FROM workflow_entity WHERE id='$1' AND active IS TRUE AND \"isArchived\" IS FALSE;"
}

workflow_execution_count() {
  n8n_db_scalar "SELECT count(*) FROM execution_entity WHERE \"workflowId\"='$1';"
}

workflow_enabled_schedule_count() {
  n8n_db_scalar "SELECT count(*) FROM workflow_entity workflow CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node WHERE workflow.id='$1' AND node->>'type'='n8n-nodes-base.scheduleTrigger' AND coalesce((node->>'disabled')::boolean,false)=false;"
}

workflow_schedule_count() {
  n8n_db_scalar "SELECT count(*) FROM workflow_entity workflow CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node WHERE workflow.id='$1' AND node->>'type'='n8n-nodes-base.scheduleTrigger';"
}

assert_workflow_inactive() {
  id=$1
  test "$(workflow_count "$id")" = 1 || die "workflow missing or duplicated: $id"
  test "$(workflow_active_count "$id")" = 0 || die "workflow is active: $id"
}

assert_workflow_active() {
  id=$1
  test "$(workflow_count "$id")" = 1 || die "workflow missing or duplicated: $id"
  test "$(workflow_active_count "$id")" = 1 || die "workflow is not published: $id"
}

workflow_source() {
  case "$1" in
    phase3StrategistV1) echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase3/campaign-strategist.v1.json" ;;
    phase3ContentProducerV1) echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase3/content-producer.v1.json" ;;
    phase4PostizDraftV1) echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase4/postiz-draft-publisher.v1.json" ;;
    phase4PostizPerformanceV1) echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase4/postiz-performance-monitor.v1.json" ;;
    phase5GhlContactUpsertV1) echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase5/ghl-contact-sync.v1.json" ;;
    phase5ConversationIntelligenceV1) echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase5/conversation-intelligence.v1.json" ;;
    phase5GovernedGhlActionsV1) echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase5/governed-ghl-actions.v1.json" ;;
    phase5gQualityShadowEvaluatorV1) echo "$RELEASE_SOURCE_ROOT/n8n/workflows/phase5g/quality-shadow-evaluator.v1.json" ;;
    *) die "unknown Tanaghom workflow ID: $1" ;;
  esac
}

import_workflow_inactive() {
  id=$1
  source=$(workflow_source "$id")
  remote="/home/node/tanaghom-$TANAGHOM_UAT_ACTIVATION_ID-$id.json"
  test -s "$source" || die "workflow source is missing: $source"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec 'umask 077; cat > "$1"' sh "$remote" <"$source"
  docker exec -u node "$N8N_MAIN_CONTAINER" test -r "$remote"
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  assert_workflow_inactive "$id"
}

export_workflow() {
  id=$1
  destination=$2
  remote="/home/node/tanaghom-$TANAGHOM_UAT_ACTIVATION_ID-$id-before.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n export:workflow --id="$id" --pretty --output="$remote" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" test -s "$remote"
  docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
}

import_export_inactive() {
  source=$1
  label=$2
  remote="/home/node/tanaghom-$TANAGHOM_UAT_ACTIVATION_ID-$label-restore.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec 'umask 077; cat > "$1"' sh "$remote" <"$source"
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n import:workflow --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
}

publish_workflow() {
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n publish:workflow --id="$1" >/dev/null
}

unpublish_workflow() {
  docker exec -u node "$N8N_MAIN_CONTAINER" n8n unpublish:workflow --id="$1" >/dev/null 2>&1 || true
}

restart_n8n_runtime() {
  docker restart "$N8N_MAIN_CONTAINER" "$N8N_WORKER_CONTAINER" >/dev/null
  wait_for_n8n_health
}

delete_new_workflows() {
  for id in $NEW_IDS; do
    test "$(workflow_active_count "$id")" = 0 || die "cannot remove active workflow: $id"
    test "$(workflow_execution_count "$id")" = 0 || die "cannot remove executed workflow: $id"
  done
  n8n_db_exec "BEGIN; DELETE FROM workflow_entity WHERE id IN ('phase4PostizPerformanceV1','phase5GhlContactUpsertV1','phase5GovernedGhlActionsV1') AND active IS FALSE; COMMIT;"
  for id in $NEW_IDS; do test "$(workflow_count "$id")" = 0 || die "workflow removal failed: $id"; done
}

capture_registry_restore_sql() {
  destination=$1
  url=$(database_url)
  PGAPPNAME=tanaghom-uat-activation psql "$url" -X -v ON_ERROR_STOP=1 -At -c \
    "SELECT format('UPDATE tanaghom.agent_workflow_registry SET runtime_state=%L,trigger_state=%L,runtime_verified_at=%L::timestamptz,runtime_evidence=%L,updated_at=%L::timestamptz WHERE code=%L;',runtime_state,trigger_state,runtime_verified_at,runtime_evidence,updated_at,code) FROM tanaghom.agent_workflow_registry WHERE code IN ('campaign_strategy_generator','campaign_content_generator','postiz_draft_publisher','postiz_performance_monitor','ghl_contact_sync','conversation_intelligence_worker','governed_ghl_actions','quality_shadow_evaluator') ORDER BY display_order;" >"$destination"
  unset url
  test "$(grep -c '^UPDATE tanaghom.agent_workflow_registry' "$destination")" = 8 ||
    die 'registry restoration SQL is incomplete'
  chmod 0600 "$destination"
}

assert_business_locks() {
  test "$(db_scalar "SELECT count(*) FROM tanaghom.automation_platform_controls WHERE emergency_stop IS NOT TRUE;")" = 0 ||
    die 'a provider platform stop is not active'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_automation_policies WHERE postiz_draft_mode<>'manual';")" = 0 ||
    die 'Postiz policy is not manual'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.organization_crm_policies WHERE contact_sync_mode<>'manual' OR conversation_processing_mode<>'paused' OR conversation_emergency_stop IS NOT TRUE OR action_mode<>'manual' OR proactive_message_mode<>'disabled' OR action_emergency_stop IS NOT TRUE;")" = 0 ||
    die 'GHL policy is not locked for UAT preparation'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.quality_rollout_policies WHERE current_stage<>'baseline';")" = 0 ||
    die 'quality rollout is not at baseline'
}

assert_zero_provider_activity() {
  test "$(db_scalar "SELECT count(*) FROM tanaghom.external_operations;")" = 0 ||
    die 'external provider operations exist'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.ghl_action_jobs;")" = 0 ||
    die 'GHL action jobs exist'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.quality_shadow_jobs;")" = 0 ||
    die 'quality shadow jobs exist'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.ghl_inbound_events event
    JOIN tanaghom.organizations organization
      ON organization.id=event.organization_id
    JOIN tanaghom.integration_connections connection
      ON connection.id=event.integration_connection_id
    WHERE NOT (
      organization.is_active IS FALSE
      AND organization.slug ~ '^conversation-canary-[0-9]{8}t[0-9]{6}z$'
      AND connection.provider='ghl'
      AND connection.status='disconnected'
      AND connection.base_url='https://ghl-shadow-canary.invalid.test'
      AND connection.credential_ciphertext IS NULL
      AND connection.credential_nonce IS NULL
      AND connection.credential_auth_tag IS NULL
      AND connection.credential_key_version IS NULL
      AND connection.secret_last_four IS NULL
      AND event.provider_event_id ~ '^event_[0-9]{8}t[0-9]{6}z$'
      AND event.status IN ('succeeded','dead_letter')
      AND (
        SELECT count(*)
        FROM tanaghom.integration_connections candidate
        WHERE candidate.organization_id=organization.id
      )=1
      AND NOT EXISTS (
        SELECT 1
        FROM tanaghom.app_users app
        WHERE app.organization_id=organization.id
          AND app.is_active
      )
      AND NOT EXISTS (
        SELECT 1
        FROM tanaghom.agent_jobs job
        WHERE job.job_type='conversation.ghl.inbound_event'
          AND job.input->>'organization_id'=organization.id::text
          AND job.status IN ('queued','running','waiting_approval')
      )
    );
  ")" = 0 ||
    die 'live, customer, or incompletely finalized GHL inbound events exist'
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type IN ('content.postiz.draft','postiz.performance.sync','lead.ghl.contact_upsert','ghl.action.execute') AND status IN ('queued','running','waiting_approval');")" = 0 ||
    die 'open provider jobs exist'
}

assert_no_claimable_core_backlog() {
  test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type IN ('campaign.strategy.generate','campaign.content.generate') AND status='queued' AND available_at<=statement_timestamp() AND attempt<max_attempts;")" = 0 ||
    die 'claimable core-agent backlog exists'
}
