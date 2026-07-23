#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_correction_environment
evidence_dir="/var/backups/tanaghom-$TANAGHOM_UAT_CORRECTION_ID"
release_file="$evidence_dir/release.env"
test -s "$release_file" || die 'correction evidence is missing'
grep -q "^RELEASE_COMMIT=$TANAGHOM_EXPECTED_RELEASE_COMMIT$" "$release_file" ||
  die 'evidence release commit differs'
restart_marker=$(sed -n 's/^RUNTIME_RESTARTED_AT=//p' "$release_file")
echo "$restart_marker" | grep -Eq \
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' ||
  die 'runtime restart marker is invalid'

assert_release_source
assert_production_worktree_reviewed
current_worktree=$(mktemp)
trap 'rm -f "$current_worktree"' EXIT HUP INT TERM
capture_production_worktree "$current_worktree"
cmp -s "$evidence_dir/production-worktree.before" "$current_worktree" ||
  die 'production dashboard worktree changed during correction'
test "$(latest_migration)" = "$EXPECTED_MIGRATION" || die 'database migration changed'
assert_n8n_healthy
assert_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
for id in $ALL_IDS; do assert_workflow_active "$id"; done
assert_all_schedules_enabled
assert_no_tanaghom_activation_errors_since "$restart_marker"
assert_business_locks
assert_zero_provider_activity
assert_bilingual_jobs_quarantined
assert_public_boundary
node "$RELEASE_SOURCE_ROOT/scripts/validate-vllm-structured-output-schemas.mjs"

test "$(db_scalar "
  SELECT count(*)
  FROM tanaghom.agent_workflow_registry
  WHERE code IN ('campaign_strategy_generator','campaign_content_generator')
    AND runtime_state='active'
    AND trigger_state='enabled'
    AND runtime_evidence='$TANAGHOM_UAT_CORRECTION_ID-runtime-schema-corrected';
")" = 2 || die 'core registry correction is invalid'
test "$(db_scalar "
  SELECT count(*)
  FROM tanaghom.agent_workflow_registry
  WHERE code IN (
    'postiz_draft_publisher','postiz_performance_monitor','ghl_contact_sync',
    'conversation_intelligence_worker','governed_ghl_actions','quality_shadow_evaluator'
  )
    AND runtime_state='active'
    AND trigger_state='enabled'
    AND runtime_evidence='$TANAGHOM_UAT_CORRECTION_ID-policy-gated-polling';
")" = 6 || die 'controlled registry correction is invalid'
test -s "$evidence_dir/n8n-audit.txt" || die 'n8n audit evidence is missing'

rm -f "$current_worktree"
trap - EXIT HUP INT TERM
echo 'PASS: corrected UAT runtime has eight valid triggers, fail-closed business authority, and healthy public boundaries.'
