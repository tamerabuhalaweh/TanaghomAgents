#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../../phase6-uat-activation/scripts/common.sh"

PREVIOUS_ACTIVATION_ID=uatactivation-20260723T041842Z
PREVIOUS_ACTIVATION_EVIDENCE="/var/backups/tanaghom-$PREVIOUS_ACTIVATION_ID"

require_correction_environment() {
  require_root
  test "${TANAGHOM_UAT_CORRECTION_AUTHORIZATION:-}" = 'CORRECT-REVIEWED-TANAGHOM-UAT-RUNTIME' ||
    die 'explicit UAT runtime correction authorization is absent'
  case "${TANAGHOM_UAT_CORRECTION_ID:-}" in
    uatcorrection-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) die 'TANAGHOM_UAT_CORRECTION_ID must use uatcorrection-YYYYMMDDTHHMMSSZ' ;;
  esac
  echo "${TANAGHOM_EXPECTED_RELEASE_COMMIT:-}" | grep -Eq '^[0-9a-f]{40}$' ||
    die 'expected release commit must be a full lowercase Git SHA'
}

assert_previous_activation_evidence() {
  test -s "$PREVIOUS_ACTIVATION_EVIDENCE/release.env" ||
    die 'previous UAT activation evidence is missing'
  grep -q '^COMMITTED_AT=' "$PREVIOUS_ACTIVATION_EVIDENCE/release.env" ||
    die 'previous UAT activation did not commit'
  test ! -e "$PREVIOUS_ACTIVATION_EVIDENCE/rollback-complete" ||
    die 'previous UAT activation was rolled back'
}

assert_current_runtime_baseline() {
  for id in $ALL_IDS; do assert_workflow_active "$id"; done
  for id in $CORE_IDS; do
    test "$(workflow_enabled_schedule_count "$id")" = 1 ||
      die "core schedule baseline changed: $id"
  done
  for id in $CONTROLLED_IDS; do
    test "$(workflow_schedule_count "$id")" = 1 ||
      die "controlled schedule baseline missing: $id"
    test "$(workflow_enabled_schedule_count "$id")" = 0 ||
      die "controlled schedule baseline changed: $id"
  done
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.agent_workflow_registry
    WHERE code IN ('campaign_strategy_generator','campaign_content_generator')
      AND runtime_state='active'
      AND trigger_state='enabled'
      AND runtime_evidence='$PREVIOUS_ACTIVATION_ID-core-polling-enabled';
  ")" = 2 || die 'core Agent Registry baseline changed'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.agent_workflow_registry
    WHERE code IN (
      'postiz_draft_publisher','postiz_performance_monitor','ghl_contact_sync',
      'conversation_intelligence_worker','governed_ghl_actions','quality_shadow_evaluator'
    )
      AND runtime_state='active'
      AND trigger_state='disabled'
      AND runtime_evidence='$PREVIOUS_ACTIVATION_ID-published-fail-closed';
  ")" = 6 || die 'controlled Agent Registry baseline changed'
}

assert_bilingual_jobs_quarantined() {
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.campaigns campaign
    JOIN tanaghom.agent_jobs job
      ON job.campaign_id=campaign.id
     AND job.job_type='campaign.strategy.generate'
    WHERE campaign.name IN (
      '.test English Core-Agent UAT 2026-07-23',
      '.test Arabic Core-Agent UAT 2026-07-23'
    )
      AND campaign.status='draft'
      AND job.status='failed'
      AND job.attempt=job.max_attempts
      AND job.error_code='gemma_http_error';
  ")" = 2 || die 'bilingual UAT jobs are not safely quarantined'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.campaign_strategies strategy
    JOIN tanaghom.campaigns campaign ON campaign.id=strategy.campaign_id
    WHERE campaign.name IN (
      '.test English Core-Agent UAT 2026-07-23',
      '.test Arabic Core-Agent UAT 2026-07-23'
    );
  ")" = 0 || die 'a bilingual UAT strategy was unexpectedly persisted'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.content_items content
    JOIN tanaghom.campaigns campaign ON campaign.id=content.campaign_id
    WHERE campaign.name IN (
      '.test English Core-Agent UAT 2026-07-23',
      '.test Arabic Core-Agent UAT 2026-07-23'
    );
  ")" = 0 || die 'bilingual UAT content was unexpectedly persisted'
}

prepare_runtime_workflows() {
  destination=$1
  install -d -m 0700 "$destination"
  node "$SCRIPT_DIR/prepare-runtime-workflows.mjs" "$RELEASE_SOURCE_ROOT" "$destination"
  chmod 0600 "$destination"/*.json
}

export_workflow() {
  id=$1
  destination=$2
  remote="/home/node/tanaghom-$TANAGHOM_UAT_CORRECTION_ID-$id-before.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n export:workflow --id="$id" --pretty --output="$remote" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" test -s "$remote"
  docker cp "$N8N_MAIN_CONTAINER:$remote" "$destination" >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
  chmod 0600 "$destination"
}

import_export_inactive() {
  source=$1
  label=$2
  remote="/home/node/tanaghom-$TANAGHOM_UAT_CORRECTION_ID-$label-restore.json"
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote" >/dev/null 2>&1 || true
  docker exec -i -u node "$N8N_MAIN_CONTAINER" sh -ec \
    'umask 077; cat > "$1"' sh "$remote" <"$source"
  docker exec -u node "$N8N_MAIN_CONTAINER" \
    n8n import:workflow --input="$remote" --activeState=false >/dev/null
  docker exec -u node "$N8N_MAIN_CONTAINER" rm -f "$remote"
}

assert_all_schedules_enabled() {
  for id in $ALL_IDS; do
    test "$(workflow_schedule_count "$id")" = 1 || die "runtime schedule missing: $id"
    test "$(workflow_enabled_schedule_count "$id")" = 1 || die "runtime schedule disabled: $id"
  done
}

assert_no_tanaghom_activation_errors_since() {
  since=$1
  logs=$(docker logs --since "$since" "$N8N_MAIN_CONTAINER" 2>&1 || true)
  if printf '%s\n' "$logs" | grep -E \
    'Tanaghom.*has no node to start|Activation of workflow "Tanaghom.*did fail|Issue on initial workflow activation try of "Tanaghom'; then
    die 'n8n reported a Tanaghom workflow activation error'
  fi
}

capture_registry_safe_rollback_sql() {
  destination=$1
  cat >"$destination" <<'SQL'
UPDATE tanaghom.agent_workflow_registry
SET runtime_state='imported_inactive',
    trigger_state='workflow_inactive_only',
    runtime_verified_at=statement_timestamp(),
    runtime_evidence='uat-runtime-correction-safe-rollback'
WHERE code IN ('campaign_strategy_generator','campaign_content_generator');
UPDATE tanaghom.agent_workflow_registry
SET runtime_state='imported_inactive',
    trigger_state='disabled',
    runtime_verified_at=statement_timestamp(),
    runtime_evidence='uat-runtime-correction-safe-rollback'
WHERE code IN (
  'postiz_draft_publisher','postiz_performance_monitor','ghl_contact_sync',
  'conversation_intelligence_worker','governed_ghl_actions','quality_shadow_evaluator'
);
SQL
  chmod 0600 "$destination"
}
