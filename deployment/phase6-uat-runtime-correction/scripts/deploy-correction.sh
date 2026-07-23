#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_correction_environment
"$SCRIPT_DIR/preflight.sh"

evidence_dir="/var/backups/tanaghom-$TANAGHOM_UAT_CORRECTION_ID"
runtime_dir="$evidence_dir/runtime-workflows"
before_dir="$evidence_dir/workflows-before"
committed=false
runtime_changed=false

test ! -e "$evidence_dir" || die 'correction evidence directory already exists'
install -d -o root -g root -m 0700 "$evidence_dir" "$runtime_dir" "$before_dir"

cleanup_remote_files() {
  for id in $ALL_IDS; do
    docker exec -u node "$N8N_MAIN_CONTAINER" rm -f \
      "/home/node/tanaghom-$TANAGHOM_UAT_CORRECTION_ID-$id.json" \
      "/home/node/tanaghom-$TANAGHOM_UAT_CORRECTION_ID-$id-before.json" \
      >/dev/null 2>&1 || true
  done
}

safe_rollback() {
  test "$committed" = false || return 0
  set +e
  rollback_failed=0
  cleanup_remote_files
  if test "$runtime_changed" = true; then
    for id in $ALL_IDS; do unpublish_workflow "$id"; done
    restart_n8n_runtime || rollback_failed=1
    for id in $ALL_IDS; do
      source="$before_dir/$id.json"
      test -s "$source" && import_export_inactive "$source" "$id" || rollback_failed=1
    done
    db_file "$evidence_dir/safe-rollback-registry.sql" >/dev/null || rollback_failed=1
  fi
  printf 'SAFE_ROLLBACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    >>"$evidence_dir/release.env" 2>/dev/null || true
  if test "$rollback_failed" -ne 0; then
    echo 'ROLLBACK_FAILED=YES' >>"$evidence_dir/release.env" 2>/dev/null || true
    echo 'ERROR: automatic safe rollback was incomplete; keep every provider stop active.' >&2
  fi
}
trap safe_rollback EXIT
trap 'exit 70' HUP INT TERM

capture_container_ids "$evidence_dir/n8n-container-ids.before"
capture_production_worktree "$evidence_dir/production-worktree.before"
capture_registry_safe_rollback_sql "$evidence_dir/safe-rollback-registry.sql"
for id in $ALL_IDS; do export_workflow "$id" "$before_dir/$id.json"; done
prepare_runtime_workflows "$runtime_dir"

cat >"$evidence_dir/release.env" <<EOF
CORRECTION_ID=$TANAGHOM_UAT_CORRECTION_ID
RELEASE_COMMIT=$TANAGHOM_EXPECTED_RELEASE_COMMIT
PREVIOUS_ACTIVATION_ID=$PREVIOUS_ACTIVATION_ID
MIGRATION=$EXPECTED_MIGRATION
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
find "$evidence_dir" -type f -exec chmod 0600 {} \;

runtime_changed=true
for id in $ALL_IDS; do import_export_inactive "$runtime_dir/$id.json" "$id"; done
assert_all_schedules_enabled
for id in $ALL_IDS; do publish_workflow "$id"; done
restart_marker=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf 'RUNTIME_RESTARTED_AT=%s\n' "$restart_marker" >>"$evidence_dir/release.env"
restart_n8n_runtime
assert_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
for id in $ALL_IDS; do assert_workflow_active "$id"; done
assert_all_schedules_enabled
assert_no_tanaghom_activation_errors_since "$restart_marker"

test "$(db_scalar "
  WITH updated AS (
    UPDATE tanaghom.agent_workflow_registry
       SET runtime_state='active',
           trigger_state='enabled',
           runtime_verified_at=statement_timestamp(),
           runtime_evidence='$TANAGHOM_UAT_CORRECTION_ID-runtime-schema-corrected'
     WHERE code IN ('campaign_strategy_generator','campaign_content_generator')
       AND runtime_state='active'
       AND trigger_state='enabled'
    RETURNING 1
  ) SELECT count(*) FROM updated;
")" = 2 || die 'core registry correction count was not two'

test "$(db_scalar "
  WITH updated AS (
    UPDATE tanaghom.agent_workflow_registry
       SET runtime_state='active',
           trigger_state='enabled',
           runtime_verified_at=statement_timestamp(),
           runtime_evidence='$TANAGHOM_UAT_CORRECTION_ID-policy-gated-polling'
     WHERE code IN (
       'postiz_draft_publisher','postiz_performance_monitor','ghl_contact_sync',
       'conversation_intelligence_worker','governed_ghl_actions','quality_shadow_evaluator'
     )
       AND runtime_state='active'
       AND trigger_state='disabled'
    RETURNING 1
  ) SELECT count(*) FROM updated;
")" = 6 || die 'controlled registry correction count was not six'

docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit >"$evidence_dir/n8n-audit.txt"
find "$evidence_dir" -type f -exec chmod 0600 {} \;
"$SCRIPT_DIR/validate-release.sh"
printf 'COMMITTED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$evidence_dir/release.env"
committed=true
trap - EXIT HUP INT TERM
cleanup_remote_files
echo "PASS: corrected eight-workflow UAT runtime is live. Evidence: $evidence_dir"
