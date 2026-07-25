#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_root
test "${TANAGHOM_ROLLBACK_AUTHORIZATION:-}" = 'ROLLBACK-THE-AUTHORIZED-TANAGHOM-RELEASE' ||
  die 'explicit rollback authorization is absent'
require_release_environment
evidence="/var/backups/tanaghom-$TANAGHOM_RELEASE_ID"
rollback_image="tanaghom-dashboard-canary:rollback-$TANAGHOM_RELEASE_ID"
test -s "$evidence/COMMITTED_AT" || die 'committed release evidence is missing'
test -z "$(agent_studio_data_summary)" ||
  die 'rollback refused because organization Agent Studio data exists'
assert_n8n_ids_unchanged "$evidence/n8n-ids.before"
sha256sum -c "$evidence/migration-down.sha256" >/dev/null ||
  die 'rollback migration checksum changed'
db_file "$PRODUCTION_ROOT/packages/database/migrations/$TARGET_MIGRATION.down.sql"
docker image tag "$rollback_image" tanaghom-dashboard-canary:canary
compose up -d --no-deps --force-recreate --no-build dashboard
test "$(db_scalar "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;")" = "$EXPECTED_START_MIGRATION" ||
  die 'rollback did not restore migration 0028'
assert_n8n_ids_unchanged "$evidence/n8n-ids.before"
date -u +%Y-%m-%dT%H:%M:%SZ > "$evidence/ROLLED_BACK_AT"
chmod 0600 "$evidence/ROLLED_BACK_AT"
echo 'PASS: Phase 7C Agent Studio empty-schema rollback completed.'
