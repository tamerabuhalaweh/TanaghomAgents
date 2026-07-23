#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
evidence_dir="/var/backups/tanaghom-$TANAGHOM_UAT_ACTIVATION_ID"
test -s "$evidence_dir/release.env" || die 'activation evidence is missing'
grep -q "^RELEASE_COMMIT=$TANAGHOM_EXPECTED_RELEASE_COMMIT$" "$evidence_dir/release.env" ||
  die 'evidence release commit differs'

assert_release_source
assert_production_worktree_reviewed
current_worktree=$(mktemp)
trap 'rm -f "$current_worktree"' EXIT HUP INT TERM
capture_production_worktree "$current_worktree"
cmp -s "$evidence_dir/production-worktree.before" "$current_worktree" ||
  die 'production dashboard worktree changed during activation'
test "$(latest_migration)" = "$EXPECTED_MIGRATION" || die "database moved from $EXPECTED_MIGRATION"
assert_n8n_healthy
assert_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
test "$(docker exec "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" ||
  die 'n8n version changed'
node "$SCRIPT_DIR/workflow-contract.mjs" "$RELEASE_SOURCE_ROOT"

for id in $ALL_IDS; do assert_workflow_active "$id"; done
for id in $CORE_IDS; do
  test "$(workflow_schedule_count "$id")" = 1 || die "core schedule missing: $id"
  test "$(workflow_enabled_schedule_count "$id")" = 1 || die "core schedule is not enabled: $id"
done
for id in $CONTROLLED_IDS; do
  test "$(workflow_schedule_count "$id")" = 1 || die "controlled schedule missing: $id"
  test "$(workflow_enabled_schedule_count "$id")" = 0 || die "provider/quality schedule is unexpectedly enabled: $id"
done
for id in $NEW_IDS; do
  test "$(workflow_execution_count "$id")" = 0 || die "new controlled workflow executed unexpectedly: $id"
done

test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code IN ('campaign_strategy_generator','campaign_content_generator') AND runtime_state='active' AND trigger_state='enabled' AND runtime_evidence='$TANAGHOM_UAT_ACTIVATION_ID-core-polling-enabled';")" = 2 ||
  die 'core registry activation is invalid'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code IN ('postiz_draft_publisher','postiz_performance_monitor','ghl_contact_sync','conversation_intelligence_worker','governed_ghl_actions','quality_shadow_evaluator') AND runtime_state='active' AND trigger_state='disabled' AND runtime_evidence='$TANAGHOM_UAT_ACTIVATION_ID-published-fail-closed';")" = 6 ||
  die 'controlled registry publication is invalid'

assert_business_locks
assert_zero_provider_activity
assert_public_boundary
test -s "$evidence_dir/n8n-audit.txt" || die 'n8n audit evidence is missing'
rm -f "$current_worktree"
trap - EXIT HUP INT TERM
echo 'PASS: UAT activation is live, core-only polling is enabled, provider authority remains fail-closed, and the public boundary is healthy.'
