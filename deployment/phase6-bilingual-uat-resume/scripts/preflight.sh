#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_resume_environment
assert_release_source
assert_production_worktree_reviewed
assert_prior_release_and_evidence
assert_migration_0028
assert_n8n_healthy
test "$(docker exec "$N8N_MAIN_CONTAINER" n8n --version)" = "$N8N_EXPECTED_VERSION" ||
  die 'n8n version changed'
assert_all_workflows_running
assert_partial_bilingual_state
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
  "$PRIOR_RELEASE_ROOT/n8n/workflows/phase3/campaign-strategist.v1.json"
grep -q 'max_tokens: 4096' "$STRATEGIST_SOURCE" ||
  die 'reviewed Strategist does not use the 4,096-token ceiling'
grep -q 'gemma_output_truncated' "$STRATEGIST_SOURCE" ||
  die 'reviewed Strategist does not classify truncated output'
echo 'PASS: Arabic bilingual-resume preflight passed.'
