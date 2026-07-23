#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_resume_environment
test "${TANAGHOM_BILINGUAL_RESUME_ROLLBACK_AUTHORIZATION:-}" = \
  'ROLLBACK-UNUSED-ARABIC-TOKEN-CORRECTION' ||
  die 'explicit Arabic token-correction rollback authorization is absent'
evidence="/var/backups/tanaghom-$TANAGHOM_BILINGUAL_RESUME_ID"
test -s "$evidence/strategist.before.json" || die 'prior Strategist evidence is missing'
test ! -e "$evidence/resume-result.env" || die 'completed resume requires forward correction'
test ! -e "$evidence/requeue-arabic.sql" || die 'Arabic job was requeued; use forward correction'
assert_partial_bilingual_state

unpublish_workflow "$STRATEGIST_ID"
import_strategist_inactive "$evidence/strategist.before.json" rollback
publish_workflow "$STRATEGIST_ID"
restart_n8n_runtime
assert_n8n_healthy
assert_container_ids_unchanged "$evidence/n8n-container-ids.before"
export_live_strategist "$evidence/strategist.rollback.json"
assert_workflow_contract_matches \
  "$evidence/strategist.rollback.json" \
  "$evidence/strategist.before.json"
printf 'ROLLBACK_COMPLETED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"$evidence/rollback-complete"
chmod 0600 "$evidence/rollback-complete"
echo 'PASS: unused Arabic token correction rolled back exactly.'
