#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
assert_release_source
assert_production_worktree_reviewed
test "$(latest_migration)" = "$EXPECTED_MIGRATION" || die "database is not at $EXPECTED_MIGRATION"
assert_n8n_healthy
test "$(docker exec "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" ||
  die 'n8n version changed'
assert_public_boundary
assert_business_locks
assert_zero_provider_activity
assert_no_claimable_core_backlog
node "$SCRIPT_DIR/workflow-contract.mjs" "$RELEASE_SOURCE_ROOT"

for id in $PREEXISTING_IDS; do assert_workflow_inactive "$id"; done
for id in $NEW_IDS; do test "$(workflow_count "$id")" = 0 || die "new workflow is unexpectedly present: $id"; done
for id in $CORE_IDS; do
  test "$(workflow_schedule_count "$id")" = 1 || die "core schedule missing: $id"
  test "$(workflow_enabled_schedule_count "$id")" = 1 || die "core schedule is not enabled in the draft: $id"
done
for id in phase4PostizDraftV1 phase5ConversationIntelligenceV1 phase5gQualityShadowEvaluatorV1; do
  test "$(workflow_schedule_count "$id")" = 1 || die "controlled schedule missing: $id"
  test "$(workflow_enabled_schedule_count "$id")" = 0 || die "controlled schedule is unexpectedly enabled: $id"
done

test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code IN ('campaign_strategy_generator','campaign_content_generator') AND runtime_state='imported_inactive' AND trigger_state='workflow_inactive_only';")" = 2 ||
  die 'core registry baseline changed'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code IN ('postiz_draft_publisher','conversation_intelligence_worker','quality_shadow_evaluator') AND runtime_state='imported_inactive' AND trigger_state='disabled';")" = 3 ||
  die 'pre-existing controlled registry baseline changed'
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_workflow_registry WHERE code IN ('postiz_performance_monitor','ghl_contact_sync','governed_ghl_actions') AND runtime_state='available_not_imported' AND trigger_state='disabled';")" = 3 ||
  die 'not-imported registry baseline changed'

test "$(n8n_db_scalar "SELECT count(*) FROM credentials_entity WHERE id IN ('62000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000005');")" = 4 ||
  die 'required encrypted n8n credentials are missing'

echo 'PASS: controlled all-agent UAT activation preflight is green.'
