#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
require_release_environment
test "${TANAGHOM_UAT_ROLLBACK_AUTHORIZATION:-}" = 'ROLLBACK-AUTHORIZED-TANAGHOM-UAT-ACTIVATION' ||
  die 'explicit UAT rollback authorization is absent'

evidence_dir="/var/backups/tanaghom-$TANAGHOM_UAT_ACTIVATION_ID"
release_file="$evidence_dir/release.env"
test -s "$release_file" || die 'activation evidence is missing'
grep -q '^COMMITTED_AT=' "$release_file" || die 'activation never committed'
test ! -e "$evidence_dir/rollback-complete" || die 'activation was already rolled back'
started_at=$(sed -n 's/^STARTED_AT=//p' "$release_file")
echo "$started_at" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' ||
  die 'recorded activation start is invalid'

assert_release_source
assert_production_worktree_reviewed
test "$(latest_migration)" = "$EXPECTED_MIGRATION" || die 'database migration changed'
assert_n8n_healthy
assert_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_business_locks
assert_zero_provider_activity
test "$(db_scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE created_at>'$started_at'::timestamptz;")" = 0 ||
  die 'new agent work exists after activation; automatic rollback is unsafe'
for id in $ALL_IDS; do assert_workflow_active "$id"; done
for id in $NEW_IDS; do
  test "$(workflow_execution_count "$id")" = 0 || die "new controlled workflow has execution history: $id"
done

for id in $ALL_IDS; do unpublish_workflow "$id"; done
restart_n8n_runtime
for id in $ALL_IDS; do assert_workflow_inactive "$id"; done

for id in $PREEXISTING_IDS; do
  source="$evidence_dir/workflows-before/$id.json"
  test -s "$source" || die "pre-deployment workflow export is missing: $id"
  import_export_inactive "$source" "$id"
  assert_workflow_inactive "$id"
done
delete_new_workflows
db_file "$evidence_dir/registry-restore.sql" >/dev/null

db_scalar "SELECT code||'|'||runtime_state||'|'||trigger_state||'|'||runtime_verified_at||'|'||runtime_evidence FROM tanaghom.agent_workflow_registry WHERE code IN ('campaign_strategy_generator','campaign_content_generator','postiz_draft_publisher','postiz_performance_monitor','ghl_contact_sync','conversation_intelligence_worker','governed_ghl_actions','quality_shadow_evaluator') ORDER BY display_order;" >"$evidence_dir/registry.rollback.tsv"
cmp -s "$evidence_dir/registry.before.tsv" "$evidence_dir/registry.rollback.tsv" ||
  die 'Agent Registry was not restored exactly'
for id in $PREEXISTING_IDS; do assert_workflow_inactive "$id"; done
for id in $NEW_IDS; do test "$(workflow_count "$id")" = 0 || die "new workflow remains after rollback: $id"; done
assert_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_public_boundary
printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$evidence_dir/rollback-complete"
chmod 0600 "$evidence_dir/rollback-complete" "$evidence_dir/registry.rollback.tsv"
echo 'PASS: exact pre-activation workflow inventory and Agent Registry state were restored.'
