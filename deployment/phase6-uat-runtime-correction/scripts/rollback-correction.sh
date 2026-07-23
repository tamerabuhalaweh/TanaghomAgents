#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_correction_environment
test "${TANAGHOM_UAT_CORRECTION_ROLLBACK_AUTHORIZATION:-}" = \
  'SAFE-ROLLBACK-TANAGHOM-UAT-RUNTIME-CORRECTION' ||
  die 'explicit correction rollback authorization is absent'

evidence_dir="/var/backups/tanaghom-$TANAGHOM_UAT_CORRECTION_ID"
test -s "$evidence_dir/release.env" || die 'correction evidence is missing'
grep -q '^COMMITTED_AT=' "$evidence_dir/release.env" || die 'correction never committed'
test ! -e "$evidence_dir/rollback-complete" || die 'correction was already rolled back'
assert_release_source
assert_production_worktree_reviewed
assert_n8n_healthy
assert_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_business_locks
assert_zero_provider_activity
assert_bilingual_jobs_quarantined

for id in $ALL_IDS; do unpublish_workflow "$id"; done
restart_n8n_runtime
for id in $ALL_IDS; do
  source="$evidence_dir/workflows-before/$id.json"
  test -s "$source" || die "pre-correction workflow export is missing: $id"
  import_export_inactive "$source" "$id"
  assert_workflow_inactive "$id"
done
db_file "$evidence_dir/safe-rollback-registry.sql" >/dev/null
assert_container_ids_unchanged "$evidence_dir/n8n-container-ids.before"
assert_public_boundary
printf 'ROLLED_BACK_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"$evidence_dir/rollback-complete"
chmod 0600 "$evidence_dir/rollback-complete"
echo 'PASS: UAT runtime correction rolled back to the safe all-inactive state without deleting evidence.'
