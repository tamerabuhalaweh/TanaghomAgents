#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

require_root
require_certification_environment
evidence="/var/backups/tanaghom-$TANAGHOM_PHASE7F_CERTIFICATION_ID-evidence-fix"
test ! -e "$evidence" || die "evidence path already exists: $evidence"
install -d -m 0700 "$evidence"
applied=0

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0 && test "$applied" = 1; then
    set +e
    if test "$(latest_migration 2>/dev/null)" = \
      0033_agent_runtime_certification_evidence &&
      test "$(db_scalar "
        SELECT count(*) FROM tanaghom.organization_agent_runtime_certifications
         WHERE organization_id='$TANAGHOM_CERTIFICATION_ORGANIZATION_ID'
           AND agent_version_id='$TANAGHOM_CERTIFICATION_AGENT_VERSION_ID';
      " 2>/dev/null)" = 0
    then
      db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/0033_agent_runtime_certification_evidence.down.sql" \
        >> "$evidence/automatic-rollback.log" 2>&1
      rollback_status=$?
      if test "$rollback_status" -ne 0; then
        echo 'AUTOMATIC_MIGRATION_ROLLBACK_FAILED=YES' >> "$evidence/update.env"
      fi
    fi
    echo "FAILED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/update.env"
    set -e
  fi
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

"$SCRIPT_DIR/preflight-evidence-fix.sh" > "$evidence/preflight.txt"
cat "$evidence/preflight.txt"
capture_production_state "$evidence/production.before"
capture_side_effect_counts "$evidence/counts.before"
url=$(database_url)
PGAPPNAME=tanaghom-phase7f-evidence-fix psql "$url" -X -v ON_ERROR_STOP=1 -At \
  -c "SELECT pg_get_functiondef(
    'tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)'::regprocedure
  );" > "$evidence/function.before.sql"
unset url
{
  echo "CERTIFICATION_ID=$TANAGHOM_PHASE7F_CERTIFICATION_ID"
  echo "PRODUCTION_COMMIT=$TANAGHOM_EXPECTED_PRODUCTION_COMMIT"
  echo "SOURCE_COMMIT=$TANAGHOM_PHASE7F_SOURCE_COMMIT"
  echo "STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$evidence/update.env"
chmod 0600 "$evidence"/*

db_file "$RELEASE_SOURCE_ROOT/packages/database/migrations/0033_agent_runtime_certification_evidence.up.sql" \
  > "$evidence/migration.txt"
applied=1
test "$(latest_migration)" = 0033_agent_runtime_certification_evidence ||
  die '0033 did not become the exact latest migration'
test "$(db_scalar "
  SELECT position(
    'invocation_summary.external_action_count'
    IN pg_get_functiondef(
      'tanaghom.build_agent_runtime_certification_evidence(uuid,uuid,uuid)'::regprocedure
    )
  )>0;
")" = t || die '0033 canonical aggregation definition differs from review'
test "$(db_scalar "
  SELECT (evidence->>'scenario_count')||'|'||
         (evidence->>'external_action_count')
  FROM (
    SELECT tanaghom.build_agent_runtime_certification_evidence(
      '$TANAGHOM_CERTIFICATION_ORGANIZATION_ID'::uuid,
      '$TANAGHOM_CERTIFICATION_AGENT_VERSION_ID'::uuid,
      '$TANAGHOM_CERTIFICATION_RUNTIME_PROFILE_ID'::uuid
    ) AS evidence
  ) canonical;
")" = '2|0' ||
  die '0033 did not preserve the two prior zero-action success scenarios'
invocations=$(db_scalar "
  SELECT coalesce(sum((
    SELECT count(*) FROM tanaghom.organization_agent_invocations invocation
     WHERE invocation.run_id=run.id
  )),0)
  FROM tanaghom.organization_agent_test_scenarios scenario
  JOIN LATERAL (
    SELECT job.* FROM tanaghom.organization_agent_jobs job
    WHERE job.scenario_id=scenario.id
      AND job.runtime_profile_id='$TANAGHOM_CERTIFICATION_RUNTIME_PROFILE_ID'
      AND job.status='succeeded' AND job.scenario_result='passed'
    ORDER BY job.finished_at DESC,job.id LIMIT 1
  ) job ON true
  JOIN LATERAL (
    SELECT candidate.* FROM tanaghom.organization_agent_runs candidate
    WHERE candidate.job_id=job.id AND candidate.status='succeeded'
    ORDER BY candidate.finished_at DESC,candidate.id LIMIT 1
  ) run ON true
  WHERE scenario.organization_id='$TANAGHOM_CERTIFICATION_ORGANIZATION_ID'
    AND scenario.agent_version_id='$TANAGHOM_CERTIFICATION_AGENT_VERSION_ID'
    AND scenario.scenario_kind='success';
")
test "$invocations" -gt 2 ||
  die 'production evidence no longer contains the reviewed multi-invocation canary'
printf 'passed_scenarios=2\nunderlying_invocations=%s\ncanonical_scenario_count=2\n' \
  "$invocations" > "$evidence/aggregation-proof.txt"

capture_side_effect_counts "$evidence/counts.after"
assert_side_effect_counts_unchanged \
  "$evidence/counts.before" "$evidence/counts.after"
assert_safety_locks
assert_running_gateway_locked
assert_protected_units_active
assert_protected_containers_healthy
assert_dashboard_network_boundary
assert_public_boundary
assert_firewall_boundary
assert_production_state_unchanged "$evidence/production.before"

echo "PASSED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/update.env"
find "$evidence" -maxdepth 1 -type f ! -name SHA256SUMS -print0 |
  sort -z | xargs -0 sha256sum > "$evidence/SHA256SUMS"
chmod 0600 "$evidence"/*
trap - EXIT HUP INT TERM
echo "PASS: migration 0033 fixed canonical multi-invocation scenario aggregation without changing runtime work, external actions or protected services. Evidence: $evidence"
