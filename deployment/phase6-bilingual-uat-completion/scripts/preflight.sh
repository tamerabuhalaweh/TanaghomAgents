#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_bilingual_environment
assert_release_source
assert_production_worktree_reviewed
test "$(latest_migration)" = "$EXPECTED_MIGRATION" ||
  die "database is not at $EXPECTED_MIGRATION"
assert_n8n_healthy
test "$(docker exec "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" ||
  die 'n8n version changed'
assert_previous_correction
assert_all_workflows_running
assert_bilingual_jobs_quarantined
assert_legacy_cadence_backfill_reviewed
assert_business_locks
assert_zero_provider_activity
assert_gemma_ready
assert_public_boundary
node "$RELEASE_SOURCE_ROOT/scripts/validate-vllm-structured-output-schemas.mjs"

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
export_live_strategist "$temporary/live.json"
assert_workflow_contract_matches \
  "$temporary/live.json" \
  "$PRODUCTION_ROOT/n8n/workflows/phase3/campaign-strategist.v1.json"
test -s "$STRATEGIST_SOURCE" || die 'reviewed Strategist export is missing'
echo 'PASS: bilingual UAT correction preflight passed.'
