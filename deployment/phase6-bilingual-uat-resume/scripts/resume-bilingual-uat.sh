#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_resume_environment
evidence="/var/backups/tanaghom-$TANAGHOM_BILINGUAL_RESUME_ID"
test -s "$evidence/release.env" || die 'resume correction evidence is missing'
grep -q '^COMMITTED_AT=' "$evidence/release.env" ||
  die 'resume correction did not commit'
test ! -e "$evidence/resume-result.env" || die 'bilingual resume already completed'
"$SCRIPT_DIR/validate-token-correction.sh"

if test -e "$evidence/requeue-arabic.sql"; then
  assert_recorded_arabic_strategy_completion
else
  assert_partial_bilingual_state
  cat >"$evidence/requeue-arabic.sql" <<SQL
BEGIN;
DO \$\$
DECLARE v_count integer;
BEGIN
  WITH updated AS (
    UPDATE tanaghom.agent_jobs job
       SET status='queued',attempt=0,output=NULL,error_code=NULL,
           error_message=NULL,available_at=statement_timestamp(),
           started_at=NULL,finished_at=NULL
      FROM tanaghom.campaigns campaign
     WHERE job.campaign_id=campaign.id
       AND campaign.name='.test Arabic Core-Agent UAT 2026-07-23'
       AND campaign.status='draft'
       AND job.job_type='campaign.strategy.generate'
       AND job.status='failed'
       AND job.attempt=job.max_attempts
       AND job.error_code='gemma_invalid_json'
    RETURNING job.id,job.correlation_id,job.agent_id,job.campaign_id
  )
  SELECT count(*) INTO v_count FROM updated;
  IF v_count<>1 THEN
    RAISE EXCEPTION 'expected exactly one terminal Arabic strategy job, found %',v_count;
  END IF;

  UPDATE tanaghom.agents
     SET status='idle',last_heartbeat_at=statement_timestamp()
   WHERE code='campaign_strategist';

  INSERT INTO tanaghom.agent_actions_log(
    correlation_id,job_id,agent_id,action_type,entity_type,entity_id,payload,result
  )
  SELECT job.correlation_id,job.id,job.agent_id,
         'uat.arabic_strategy_job_requeued','campaign',job.campaign_id,
         jsonb_build_object(
           'resume_id','$TANAGHOM_BILINGUAL_RESUME_ID',
           'prior_attempt',3,
           'reason','corrected_input_field_mapping_and_reviewed_ceiling'
         ),
         'success'
  FROM tanaghom.agent_jobs job
  JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
  WHERE campaign.name='.test Arabic Core-Agent UAT 2026-07-23'
    AND job.job_type='campaign.strategy.generate'
    AND job.status='queued' AND job.attempt=0;
END
\$\$;
COMMIT;
SQL
  chmod 0600 "$evidence/requeue-arabic.sql"
  db_file "$evidence/requeue-arabic.sql"
  printf 'ARABIC_REQUEUED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    >>"$evidence/release.env"
fi

if grep -q '^CONTINUATION_RELEASE_COMMIT=' "$evidence/release.env"; then
  grep -q "^CONTINUATION_RELEASE_COMMIT=$TANAGHOM_EXPECTED_RELEASE_COMMIT\$" \
    "$evidence/release.env" ||
    die 'continuation release commit differs from the recorded correction'
else
  printf 'CONTINUATION_RELEASE_COMMIT=%s\n' \
    "$TANAGHOM_EXPECTED_RELEASE_COMMIT" >>"$evidence/release.env"
fi

TANAGHOM_BILINGUAL_UAT_ID=$ORIGINAL_UAT_ID \
TANAGHOM_BILINGUAL_UAT_AUTHORIZATION=COMPLETE-REVIEWED-TANAGHOM-BILINGUAL-UAT \
TANAGHOM_BILINGUAL_CONTINUE_ONLY=true \
  "$RELEASE_SOURCE_ROOT/deployment/phase6-bilingual-uat-completion/scripts/run-bilingual-uat.sh"

test -s "$ORIGINAL_EVIDENCE/uat-result.env" ||
  die 'original bilingual evidence did not record completion'
grep -q '^RESULT=passed$' "$ORIGINAL_EVIDENCE/uat-result.env" ||
  die 'continued bilingual UAT did not pass'
cat >"$evidence/resume-result.env" <<EOF
RESUME_COMPLETED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ORIGINAL_UAT_ID=$ORIGINAL_UAT_ID
ORIGINAL_RESULT=$ORIGINAL_EVIDENCE/uat-result.env
RESULT=passed
EOF
chmod 0600 "$evidence/resume-result.env"
echo "PASS: bilingual UAT resumed to human review. Evidence: $evidence"
