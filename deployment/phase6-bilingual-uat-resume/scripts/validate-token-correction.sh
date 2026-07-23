#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_resume_environment
evidence="/var/backups/tanaghom-$TANAGHOM_BILINGUAL_RESUME_ID"
test -d "$evidence" || die 'resume correction evidence is missing'
assert_migration_0028
assert_n8n_healthy
assert_container_ids_unchanged "$evidence/n8n-container-ids.before"
assert_all_workflows_running
assert_partial_bilingual_state
assert_business_locks
assert_zero_provider_activity
assert_gemma_ready
assert_public_boundary

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
export_live_strategist "$temporary/live.json"
assert_workflow_contract_matches "$temporary/live.json" "$STRATEGIST_SOURCE"
test -s "$evidence/probe-result.env" || die 'successful Arabic probe evidence is missing'
grep -q '^RESULT=passed$' "$evidence/probe-result.env" ||
  die 'Arabic Gemma probe did not pass'
grep -q '^MAX_OUTPUT_TOKENS=4096$' "$evidence/probe-result.env" ||
  die 'Arabic Gemma probe did not use the reviewed token ceiling'
echo 'PASS: live Strategist uses the reviewed Arabic-safe bounded contract.'
