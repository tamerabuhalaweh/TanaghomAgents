#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

require_bilingual_environment
evidence="/var/backups/tanaghom-$TANAGHOM_BILINGUAL_UAT_ID"
test -s "$evidence/release.env" || die 'committed correction evidence is missing'
grep -q '^COMMITTED_AT=' "$evidence/release.env" ||
  die 'cadence correction did not commit'
test ! -e "$evidence/uat-result.env" || die 'bilingual UAT already completed'
"$SCRIPT_DIR/validate-correction.sh"
continue_only=${TANAGHOM_BILINGUAL_CONTINUE_ONLY:-false}
if test "$continue_only" = true; then
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.agent_jobs job
    JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
    WHERE campaign.name IN ($UAT_CAMPAIGNS)
      AND job.job_type='campaign.strategy.generate'
      AND (
        (campaign.name='.test English Core-Agent UAT 2026-07-23'
          AND job.status='succeeded')
        OR
        (campaign.name='.test Arabic Core-Agent UAT 2026-07-23'
          AND job.status='queued' AND job.attempt=0)
      );
  ")" = 2 || die 'bilingual continuation state is not exact'
  test "$(db_scalar "
    SELECT count(*)
    FROM tanaghom.campaign_strategies strategy
    JOIN tanaghom.campaigns campaign ON campaign.id=strategy.campaign_id
    WHERE campaign.name='.test English Core-Agent UAT 2026-07-23';
  ")" = 1 || die 'the successful English strategy was not preserved'
else
  assert_bilingual_jobs_quarantined

  cat >"$evidence/requeue.sql" <<SQL
BEGIN;
DO \$\$
DECLARE
  v_count integer;
BEGIN
  WITH updated AS (
    UPDATE tanaghom.agent_jobs job
       SET status='queued',
           attempt=0,
           output=NULL,
           error_code=NULL,
           error_message=NULL,
           available_at=statement_timestamp(),
           started_at=NULL,
           finished_at=NULL
      FROM tanaghom.campaigns campaign
     WHERE job.campaign_id=campaign.id
       AND job.job_type='campaign.strategy.generate'
       AND campaign.name IN ($UAT_CAMPAIGNS)
       AND campaign.status='draft'
       AND job.status='failed'
       AND job.attempt=job.max_attempts
       AND job.error_code='gemma_http_error'
    RETURNING job.id,job.correlation_id,job.agent_id,job.campaign_id
  )
  SELECT count(*) INTO v_count FROM updated;
  IF v_count<>2 THEN
    RAISE EXCEPTION 'expected exactly two bilingual jobs, found %',v_count;
  END IF;

  UPDATE tanaghom.agents
     SET status='idle',last_heartbeat_at=statement_timestamp()
   WHERE code='campaign_strategist';

  INSERT INTO tanaghom.agent_actions_log(
    correlation_id,job_id,agent_id,action_type,entity_type,entity_id,payload,result
  )
  SELECT job.correlation_id,job.id,job.agent_id,
         'uat.strategy_job_requeued','campaign',job.campaign_id,
         jsonb_build_object(
           'uat_id','$TANAGHOM_BILINGUAL_UAT_ID',
           'prior_attempt',3,
           'reason','corrected_schema_and_semantic_guard_passed'
         ),
         'success'
  FROM tanaghom.agent_jobs job
  JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
  WHERE campaign.name IN ($UAT_CAMPAIGNS)
    AND job.job_type='campaign.strategy.generate'
    AND job.status='queued'
    AND job.attempt=0;
END
\$\$;
COMMIT;
SQL
  chmod 0600 "$evidence/requeue.sql"
  db_file "$evidence/requeue.sql"
  requeued_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf 'REQUEUED_AT=%s\n' "$requeued_at" >>"$evidence/release.env"
fi

attempt=0
while :; do
  succeeded=$(db_scalar "
    SELECT count(*)
    FROM tanaghom.agent_jobs job
    JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
    WHERE campaign.name IN ($UAT_CAMPAIGNS)
      AND job.job_type='campaign.strategy.generate'
      AND job.status='succeeded';
  ")
  failed=$(db_scalar "
    SELECT count(*)
    FROM tanaghom.agent_jobs job
    JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
    WHERE campaign.name IN ($UAT_CAMPAIGNS)
      AND job.job_type='campaign.strategy.generate'
      AND job.status='failed'
      AND job.attempt=job.max_attempts;
  ")
  test "$failed" = 0 || die 'a corrected bilingual strategy job exhausted retries'
  test "$succeeded" = 2 && break
  attempt=$((attempt + 1))
  test "$attempt" -lt 80 || die 'bilingual strategy completion timed out'
  sleep 15
done

test "$(db_scalar "
  SELECT count(*)
  FROM tanaghom.campaign_strategies strategy
  JOIN tanaghom.campaigns campaign ON campaign.id=strategy.campaign_id
  WHERE campaign.name IN ($UAT_CAMPAIGNS)
    AND tanaghom.campaign_strategy_cadence_is_valid(
      strategy.channels,strategy.posting_cadence
    );
")" = 2 || die 'two valid persisted strategies were not produced'

owner_id=$(db_scalar "
  SELECT id
  FROM tanaghom.app_users
  WHERE email='tamer.abuhalaweh@gmail.com'
    AND kind='human' AND role='owner' AND is_active AND accepted_at IS NOT NULL;
")
echo "$owner_id" | grep -Eq '^[0-9a-f-]{36}$' ||
  die 'accepted UAT owner is unavailable'
queued=$(db_scalar "
  WITH selected AS MATERIALIZED (
    SELECT id
    FROM tanaghom.campaigns
    WHERE name IN ($UAT_CAMPAIGNS)
      AND status='strategy_ready'
  )
  SELECT count(*)
  FROM selected campaign
  CROSS JOIN LATERAL tanaghom.queue_campaign_content(
    campaign.id,'$owner_id'::uuid
  ) queued;
")
test "$queued" = 2 || die 'exactly two content jobs were not queued'
content_queued_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf 'CONTENT_QUEUED_AT=%s\n' "$content_queued_at" >>"$evidence/release.env"

attempt=0
while :; do
  waiting=$(db_scalar "
    SELECT count(*)
    FROM tanaghom.agent_jobs job
    JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
    WHERE campaign.name IN ($UAT_CAMPAIGNS)
      AND job.job_type='campaign.content.generate'
      AND job.status='waiting_approval';
  ")
  failed=$(db_scalar "
    SELECT count(*)
    FROM tanaghom.agent_jobs job
    JOIN tanaghom.campaigns campaign ON campaign.id=job.campaign_id
    WHERE campaign.name IN ($UAT_CAMPAIGNS)
      AND job.job_type='campaign.content.generate'
      AND job.status='failed'
      AND job.attempt=job.max_attempts;
  ")
  test "$failed" = 0 || die 'a bilingual content job exhausted retries'
  test "$waiting" = 2 && break
  attempt=$((attempt + 1))
  test "$attempt" -lt 80 || die 'bilingual content completion timed out'
  sleep 15
done

test "$(db_scalar "
  SELECT count(*)
  FROM tanaghom.content_items content
  JOIN tanaghom.campaigns campaign ON campaign.id=content.campaign_id
  WHERE campaign.name IN ($UAT_CAMPAIGNS)
    AND content.status='pending_approval';
")" = 4 || die 'exactly four pending human-review drafts were not produced'
test "$(db_scalar "
  SELECT count(*)
  FROM (
    SELECT campaign.id
    FROM tanaghom.campaigns campaign
    JOIN tanaghom.content_items content ON content.campaign_id=campaign.id
    WHERE campaign.name IN ($UAT_CAMPAIGNS)
      AND content.status='pending_approval'
    GROUP BY campaign.id
    HAVING count(*)=2
  ) exact_campaigns;
")" = 2 || die 'each bilingual campaign did not produce exactly two drafts'
test "$(db_scalar "
  SELECT count(*)
  FROM tanaghom.content_items content
  JOIN tanaghom.campaigns campaign ON campaign.id=content.campaign_id
  WHERE campaign.name='.test Arabic Core-Agent UAT 2026-07-23'
    AND content.draft_copy ~ '[ء-ي]';
")" = 2 || die 'Arabic UAT drafts do not contain Arabic text'
test "$(db_scalar "
  SELECT count(*)
  FROM tanaghom.content_items content
  JOIN tanaghom.campaigns campaign ON campaign.id=content.campaign_id
  WHERE campaign.name='.test English Core-Agent UAT 2026-07-23'
    AND content.draft_copy ~ '[A-Za-z]';
")" = 2 || die 'English UAT drafts do not contain English text'

assert_business_locks
assert_zero_provider_activity
assert_all_workflows_running
assert_gemma_ready
grep -q "^GEMMA_PID=$(systemctl show "$GEMMA_UNIT" -p MainPID --value)$" \
  "$evidence/release.env" ||
  die 'Gemma process changed after the corrected probe'
docker exec -u node "$N8N_MAIN_CONTAINER" n8n audit >"$evidence/n8n-audit-after-uat.txt"
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat >"$evidence/uat-result.env" <<EOF
UAT_COMPLETED_AT=$completed_at
STRATEGY_JOBS_SUCCEEDED=2
STRATEGIES_PERSISTED=2
CONTENT_JOBS_WAITING_APPROVAL=2
PENDING_HUMAN_REVIEW_DRAFTS=4
ARABIC_DRAFTS=2
ENGLISH_DRAFTS=2
EXTERNAL_PROVIDER_OPERATIONS=0
RESULT=passed
EOF
chmod 0600 "$evidence/uat-result.env"
echo "PASS: bilingual UAT reached four human-review drafts. Evidence: $evidence"
