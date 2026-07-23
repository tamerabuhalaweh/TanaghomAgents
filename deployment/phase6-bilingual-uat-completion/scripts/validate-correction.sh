#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_bilingual_environment
evidence="/var/backups/tanaghom-$TANAGHOM_BILINGUAL_UAT_ID"
test -d "$evidence" || die 'correction evidence is missing'
test "$(latest_migration)" = "$TARGET_MIGRATION" ||
  die 'strategy cadence migration is not applied'
test "$(db_scalar "
  SELECT count(*)
  FROM pg_constraint
  WHERE conrelid='tanaghom.campaign_strategies'::regclass
    AND conname='campaign_strategies_cadence_integrity_check'
    AND contype='c' AND convalidated;
")" = 1 || die 'validated database cadence constraint is missing'
test "$(db_scalar "
  SELECT count(*)
  FROM tanaghom.strategy_cadence_0028_legacy_backup;
")" = 3 || die 'exactly three reviewed legacy cadence sources were not preserved'
test "$(db_scalar "
  SELECT count(*)
  FROM tanaghom.campaign_strategies strategy
  WHERE NOT tanaghom.campaign_strategy_cadence_is_valid(
    strategy.channels,strategy.posting_cadence
  );
")" = 0 || die 'a persisted strategy remains outside the cadence guard'
assert_n8n_healthy
assert_container_ids_unchanged "$evidence/n8n-container-ids.before"
assert_all_workflows_running
assert_business_locks
assert_zero_provider_activity
assert_gemma_ready
assert_public_boundary

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
export_live_strategist "$temporary/live.json"
assert_workflow_contract_matches "$temporary/live.json" "$STRATEGIST_SOURCE"
test -s "$evidence/probe-result.env" || die 'successful Gemma probe evidence is missing'
grep -q '^RESULT=passed$' "$evidence/probe-result.env" ||
  die 'Gemma probe did not pass'
echo 'PASS: cadence guard and corrected live Strategist workflow are active.'
