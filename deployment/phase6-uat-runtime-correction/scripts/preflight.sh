#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_correction_environment
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
assert_previous_activation_evidence
assert_current_runtime_baseline
assert_bilingual_jobs_quarantined
node "$RELEASE_SOURCE_ROOT/scripts/validate-vllm-structured-output-schemas.mjs"
node "$SCRIPT_DIR/../../phase6-uat-activation/scripts/workflow-contract.mjs" "$RELEASE_SOURCE_ROOT"

test "$(n8n_db_scalar "
  SELECT count(*)
  FROM credentials_entity
  WHERE id IN (
    '62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000004',
    '62000000-0000-4000-8000-000000000005'
  );
")" = 4 || die 'required encrypted n8n credentials are missing'

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
prepare_runtime_workflows "$temporary"
test "$(find "$temporary" -type f -name '*.json' | wc -l)" = 8 ||
  die 'runtime workflow preparation is incomplete'

echo 'PASS: live UAT runtime correction preflight is green.'
