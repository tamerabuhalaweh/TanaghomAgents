#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_certification_environment
test "${TANAGHOM_PHASE7F_CERTIFICATION_ROLLBACK_AUTHORIZATION:-}" = \
  'GO-ROLLBACK-UNCERTIFIED-EVIDENCE-FIX' ||
  die 'explicit uncertified evidence-fix rollback authorization is absent'
test "$(latest_migration)" = 0033_agent_runtime_certification_evidence ||
  die '0033 is not the exact rollback boundary'
test "$(db_scalar "
  SELECT count(*) FROM tanaghom.organization_agent_jobs
   WHERE status IN ('queued','running','waiting_approval');
")" = 0 || die 'runtime work must be closed before rollback'
test "$(db_scalar "
  SELECT count(*) FROM tanaghom.organization_agent_runtime_certifications
   WHERE organization_id='$TANAGHOM_CERTIFICATION_ORGANIZATION_ID'
     AND agent_version_id='$TANAGHOM_CERTIFICATION_AGENT_VERSION_ID';
")" = 0 || die 'rollback is forbidden after immutable certification is recorded'
assert_safety_locks
db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/0033_agent_runtime_certification_evidence.down.sql"
test "$(latest_migration)" = 0032_gemma_served_model_profile ||
  die '0033 rollback did not restore exact migration 0032'
assert_safety_locks
echo 'PASS: the uncertified 0033 function definition was restored to 0032; no runtime evidence was deleted.'
