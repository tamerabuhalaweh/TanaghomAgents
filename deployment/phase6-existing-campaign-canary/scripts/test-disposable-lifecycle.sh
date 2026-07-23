#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-existing-campaign-canary"
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }
name='Existing campaign canary disposable.test'
actor='00000000-0000-4000-8000-000000000001'

psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <"$1"; }
scalar() { psql "$url" -X -q -v ON_ERROR_STOP=1 -At -c "$1" | tr -d '\r'; }
for file in "$root"/packages/database/migrations/*.up.sql; do
  psql_file "$file"
  test "$(basename "$file")" = 0025_runtime_agent_reconciliation.up.sql && break
done
psql_file "$root/packages/database/seeds/staging.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0025_runtime_agent_reconciliation

campaign_id=$(scalar "SET ROLE tanaghom_api; SELECT campaign_id FROM tanaghom.create_campaign_draft('$actor','$name','Disposable zero-budget campaign for validating an existing campaign exact-ID canary without any provider action.','camp','{\"audience\":\"Fictional families evaluating a creativity camp\",\"geography\":\"Amman, Jordan\",\"languages\":[\"en\",\"ar\"]}',0,0,'USD',3); RESET ROLE;")
scalar "SET ROLE tanaghom_api; SELECT campaign_id FROM tanaghom.revise_campaign_brief('$campaign_id','$actor','$name','Revised disposable zero-budget brief proving exact campaign preservation and governed job handoff.','camp','{\"audience\":\"Fictional families evaluating a creativity camp\",\"geography\":\"Amman, Jordan\",\"languages\":[\"en\",\"ar\"]}',0,0,'USD',3); RESET ROLE;" >/dev/null
strategy_job_id=$(scalar "SET ROLE tanaghom_api; SELECT job_id FROM tanaghom.queue_campaign_strategy('$campaign_id','$actor'); RESET ROLE;")

operator() { DATABASE_URL="$url" TANAGHOM_EXPECTED_MIGRATION=0025_runtime_agent_reconciliation node "$package/scripts/existing-campaign-operator.mjs" "$1" "$campaign_id" "$strategy_job_id" "$name" 3 "${2:-}"; }
operator check-database >/dev/null
operator verify-authorized >/dev/null

# A second claimable core job must close the gate, even for another campaign.
scalar "INSERT INTO tanaghom.agent_jobs(id,correlation_id,agent_id,campaign_id,job_type,status,attempt,max_attempts,input) VALUES ('94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','campaign.strategy.generate','queued',0,3,'{}');" >/dev/null
if operator verify-authorized >/dev/null 2>&1; then echo 'operator accepted competing claimable work' >&2; exit 1; fi
scalar "DELETE FROM tanaghom.agent_jobs WHERE id='94000000-0000-4000-8000-000000000001';" >/dev/null
operator verify-authorized >/dev/null

psql "$url" -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
SET ROLE tanaghom_n8n_worker;
SELECT * FROM tanaghom.claim_agent_job('campaign_strategist',ARRAY['campaign.strategy.generate']);
SELECT tanaghom.persist_strategy_result(
  '$strategy_job_id',
  '{"contract_version":"phase3.strategist-output.v1","status":"ok","positioning":"Safe family creativity","key_messages":["Create together","Learn safely","Build confidence"],"channels":["instagram"],"posting_cadence":{"instagram":{"posts_per_week":3}},"content_pillars":[{"name":"Creativity","description":"Practical creativity","example_angles":["Family exercise"]},{"name":"Confidence","description":"Confidence outcomes","example_angles":["Small wins"]},{"name":"Community","description":"Shared learning","example_angles":["Parent stories"]},{"name":"Camp","description":"Camp experience","example_angles":["What to expect"]}]}'::jsonb,
  'gemma-disposable','campaign-strategist/v1');
RESET ROLE;
SQL
operator verify-strategy >/dev/null
operator verify-resume-authorized >/dev/null
queue_json=$(operator queue-content)
content_job_id=$(printf '%s' "$queue_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).content_job_id))')
printf '%s' "$content_job_id" | grep -Eq '^[0-9a-f-]{36}$'
if operator verify-resume-authorized >/dev/null 2>&1; then echo 'resume authorization accepted an existing content job' >&2; exit 1; fi
operator verify-content-ready "$content_job_id" >/dev/null

psql "$url" -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
SET ROLE tanaghom_n8n_worker;
SELECT * FROM tanaghom.claim_agent_job('content_producer',ARRAY['campaign.content.generate']);
SELECT tanaghom.persist_content_result(
  '$content_job_id',
  '{"contract_version":"phase3.content-producer-output.v1","items":[
    {"channel":"instagram","content_type":"post","content_pillar":"Creativity","draft_copy":"First safe disposable draft.","media_brief":"Family activity one.","scheduled_time_suggestion":null},
    {"channel":"instagram","content_type":"post","content_pillar":"Confidence","draft_copy":"Second safe disposable draft.","media_brief":"Family activity two.","scheduled_time_suggestion":null},
    {"channel":"instagram","content_type":"post","content_pillar":"Community","draft_copy":"Third safe disposable draft.","media_brief":"Family activity three.","scheduled_time_suggestion":null}
  ]}'::jsonb,
  'gemma-disposable','content-producer/v1');
RESET ROLE;
SQL
operator verify-pending "$content_job_id" >/dev/null
test "$(scalar "SELECT count(*) FROM tanaghom.content_items WHERE campaign_id='$campaign_id' AND status='pending_approval';")" = 3
test "$(scalar 'SELECT count(*) FROM tanaghom.external_operations;')" = 0

scalar "SET ROLE tanaghom_api; INSERT INTO tanaghom.content_approvals(content_item_id,decision,decided_by) SELECT id,'approved','$actor' FROM tanaghom.content_items WHERE campaign_id='$campaign_id'; UPDATE tanaghom.content_items SET status='approved' WHERE campaign_id='$campaign_id'; SELECT completed_jobs FROM tanaghom.reconcile_campaign_content_jobs('$campaign_id','$actor'); RESET ROLE;" >/dev/null
operator verify-approved "$content_job_id" >/dev/null
test "$(scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE id='$content_job_id' AND status='succeeded';")" = 1
test "$(scalar "SELECT count(*) FROM tanaghom.agent_actions_log WHERE job_id='$content_job_id' AND action_type='content.review_completed' AND result='success';")" = 1
test "$(scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE campaign_id='$campaign_id' AND job_type NOT IN ('campaign.strategy.generate','campaign.content.generate');")" = 0
echo 'PASS: exact identity, competing-work refusal, governed queueing, three-draft generation, human approval, and provider isolation passed in disposable PostgreSQL.'
