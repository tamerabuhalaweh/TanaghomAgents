#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_bilingual_environment
test "${TANAGHOM_BILINGUAL_UAT_ROLLBACK_AUTHORIZATION:-}" = \
  'ROLLBACK-UNUSED-BILINGUAL-UAT-CORRECTION' ||
  die 'explicit rollback authorization is absent'
evidence="/var/backups/tanaghom-$TANAGHOM_BILINGUAL_UAT_ID"
test -s "$evidence/release.env" || die 'correction evidence is missing'
grep -q '^COMMITTED_AT=' "$evidence/release.env" ||
  die 'correction did not commit'
test ! -e "$evidence/uat-result.env" ||
  die 'rollback refuses after bilingual UAT produced reviewed evidence'
assert_bilingual_jobs_quarantined
assert_zero_provider_activity
sha256sum -c "$evidence/reviewed-inputs.sha256" >/dev/null ||
  die 'reviewed correction inputs changed'

unpublish_workflow "$STRATEGIST_ID"
import_strategist_inactive "$evidence/strategist.before.json" rollback
publish_workflow "$STRATEGIST_ID"
restart_n8n_runtime
assert_container_ids_unchanged "$evidence/n8n-container-ids.before"
db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql"
test "$(latest_migration)" = "$EXPECTED_MIGRATION" ||
  die 'database rollback did not return to 0027'
assert_all_workflows_running
printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"$evidence/rollback-complete"
chmod 0600 "$evidence/rollback-complete"
echo 'PASS: unused cadence correction rolled back without changing UAT jobs.'
