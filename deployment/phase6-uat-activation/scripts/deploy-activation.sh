#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
"$SCRIPT_DIR/preflight.sh"

evidence_dir="/var/backups/tanaghom-$TANAGHOM_UAT_ACTIVATION_ID"
registry_restore=
committed=false
runtime_changed=false

test ! -e "$evidence_dir" || die 'activation evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence_dir" "$evidence_dir/workflows-before"
registry_restore="$evidence_dir/registry-restore.sql"

cleanup_remote_files() {
  for id in $ALL_IDS; do
    docker exec -u node "$N8N_MAIN_CONTAINER" rm -f \
      "/home/node/tanaghom-$TANAGHOM_UAT_ACTIVATION_ID-$id.json" \
      "/home/node/tanaghom-$TANAGHOM_UAT_ACTIVATION_ID-$id-before.json" \
      "/home/node/tanaghom-$TANAGHOM_UAT_ACTIVATION_ID-$id-restore.json" >/dev/null 2>&1 || true
  done
}

automatic_rollback() {
  test "$committed" = false || return 0
  set +e
  rollback_failed=0
  cleanup_remote_files
  if test "$runtime_changed" = true; then
    for id in $ALL_IDS; do
      test "$(workflow_count "$id" 2>/dev/null)" = 1 && unpublish_workflow "$id"
    done
    restart_n8n_runtime || rollback_failed=1
    for id in $PREEXISTING_IDS; do
      file="$evidence_dir/workflows-before/$id.json"
      test -s "$file" && import_export_inactive "$file" "$id" || rollback_failed=1
    done
    delete_new_workflows || rollback_failed=1
    test -s "$registry_restore" && db_file "$registry_restore" >/dev/null || rollback_failed=1
  fi
  printf 'AUTOMATIC_ROLLBACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$evidence_dir/release.env" 2>/dev/null || true
  if test "$rollback_failed" -ne 0; then
    echo 'ROLLBACK_FAILED=YES' >>"$evidence_dir/release.env" 2>/dev/null || true
    echo 'ERROR: automatic rollback was incomplete; keep every provider stop active.' >&2
  fi
}
trap automatic_rollback EXIT
trap 'exit 70' HUP INT TERM

capture_container_ids "$evidence_dir/n8n-container-ids.before"
capture_production_worktree "$evidence_dir/production-worktree.before"
capture_registry_restore_sql "$registry_restore"
db_scalar "SELECT code||'|'||runtime_state||'|'||trigger_state||'|'||runtime_verified_at||'|'||runtime_evidence FROM tanaghom.agent_workflow_registry WHERE code IN ('campaign_strategy_generator','campaign_content_generator','postiz_draft_publisher','postiz_performance_monitor','ghl_contact_sync','conversation_intelligence_worker','governed_ghl_actions','quality_shadow_evaluator') ORDER BY display_order;" >"$evidence_dir/registry.before.tsv"
n8n_db_scalar "SELECT id||'|'||name||'|'||active||'|'||\"isArchived\" FROM workflow_entity WHERE id IN ('phase3StrategistV1','phase3ContentProducerV1','phase4PostizDraftV1','phase4PostizPerformanceV1','phase5GhlContactUpsertV1','phase5ConversationIntelligenceV1','phase5GovernedGhlActionsV1','phase5gQualityShadowEvaluatorV1') ORDER BY id;" >"$evidence_dir/n8n-workflows.before.tsv"

for id in $PREEXISTING_IDS; do
  export_workflow "$id" "$evidence_dir/workflows-before/$id.json"
done

cat >"$evidence_dir/release.env" <<EOF
ACTIVATION_ID=$TANAGHOM_UAT_ACTIVATION_ID
RELEASE_COMMIT=$TANAGHOM_EXPECTED_RELEASE_COMMIT
PRODUCTION_COMMIT=$EXPECTED_PRODUCTION_COMMIT
MIGRATION=$EXPECTED_MIGRATION
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CORE_WORKFLOWS=$CORE_IDS
CONTROLLED_WORKFLOWS=$CONTROLLED_IDS
EOF
chmod 0600 "$evidence_dir"/* "$evidence_dir/workflows-before"/*

runtime_changed=true
for id in $ALL_IDS; do import_workflow_inactive "$id"; done

for id in $CORE_IDS; do
  test "$(workflow_schedule_count "$id")" = 1 || die "core schedule missing after import: $id"
  test "$(workflow_enabled_schedule_count "$id")" = 1 || die "core schedule disabled after import: $id"
done
for id in $CONTROLLED_IDS; do
  test "$(workflow_schedule_count "$id")" = 1 || die "controlled schedule missing after import: $id"
  test "$(workflow_enabled_schedule_count "$id")" = 0 || die "controlled schedule enabled after import: $id"
done

for id in $ALL_IDS; do publish_workflow "$id"; done
restart_n8n_runtime
assert_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
for id in $ALL_IDS; do assert_workflow_active "$id"; done

test "$(db_scalar "WITH updated AS (
  UPDATE tanaghom.agent_workflow_registry
     SET runtime_state='active',trigger_state='enabled',runtime_verified_at=statement_timestamp(),
         runtime_evidence='$TANAGHOM_UAT_ACTIVATION_ID-core-polling-enabled'
   WHERE code IN ('campaign_strategy_generator','campaign_content_generator')
     AND runtime_state='imported_inactive'
  RETURNING 1
) SELECT count(*) FROM updated;")" = 2 || die 'core registry activation count was not two'

test "$(db_scalar "WITH updated AS (
  UPDATE tanaghom.agent_workflow_registry
     SET runtime_state='active',trigger_state='disabled',runtime_verified_at=statement_timestamp(),
         runtime_evidence='$TANAGHOM_UAT_ACTIVATION_ID-published-fail-closed'
   WHERE code IN ('postiz_draft_publisher','postiz_performance_monitor','ghl_contact_sync',
                  'conversation_intelligence_worker','governed_ghl_actions','quality_shadow_evaluator')
     AND runtime_state IN ('available_not_imported','imported_inactive')
  RETURNING 1
) SELECT count(*) FROM updated;")" = 6 || die 'controlled registry publication count was not six'

docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit >"$evidence_dir/n8n-audit.txt"
n8n_db_scalar "SELECT id||'|'||name||'|'||active||'|'||\"isArchived\" FROM workflow_entity WHERE id IN ('phase3StrategistV1','phase3ContentProducerV1','phase4PostizDraftV1','phase4PostizPerformanceV1','phase5GhlContactUpsertV1','phase5ConversationIntelligenceV1','phase5GovernedGhlActionsV1','phase5gQualityShadowEvaluatorV1') ORDER BY id;" >"$evidence_dir/n8n-workflows.after.tsv"
chmod 0600 "$evidence_dir"/*

"$SCRIPT_DIR/validate-release.sh"
printf 'COMMITTED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$evidence_dir/release.env"
committed=true
trap - EXIT HUP INT TERM
cleanup_remote_files
echo "PASS: eight Tanaghom workflows are published; only the two core schedules are enabled. Evidence: $evidence_dir"
