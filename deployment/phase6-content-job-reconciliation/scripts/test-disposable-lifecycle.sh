#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-content-job-reconciliation"
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }
campaign='Controlled content reconciliation.test'
job_id='93000000-0000-4000-8000-000000000001'
strategy_job_id='93000000-0000-4000-8000-000000000002'
content_one='93000000-0000-4000-8000-000000000011'
content_two='93000000-0000-4000-8000-000000000012'

psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
scalar() { psql "$url" -X -v ON_ERROR_STOP=1 -At -c "$1"; }
operator() { DATABASE_URL="$url" node "$package/scripts/reconcile-operator.mjs" "$1" "$campaign" "$job_id"; }

for file in "$root"/packages/database/migrations/*.up.sql; do psql_file "$file"; done
psql_file "$root/packages/database/seeds/staging.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0022_agent_registry

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<SQL
INSERT INTO tanaghom.campaign_strategies
  (id,campaign_id,version,positioning,key_messages,channels,posting_cadence,content_pillars,model_name,prompt_version)
VALUES
  ('93000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000001',1,'Test position','["one","two","three"]','["instagram"]','{"instagram":{"posts_per_week":1}}','[{"name":"Proof"},{"name":"People"},{"name":"Process"},{"name":"Offer"}]','gemma-test','content-reconciliation-test/v1');
UPDATE tanaghom.campaigns SET name='$campaign',status='strategy_ready' WHERE id='20000000-0000-4000-8000-000000000001';
UPDATE tanaghom.campaigns SET status='content_in_progress' WHERE id='20000000-0000-4000-8000-000000000001';
INSERT INTO tanaghom.agent_jobs
  (id,correlation_id,agent_id,campaign_id,job_type,status,attempt,max_attempts,input,output,started_at,finished_at)
VALUES
  ('$strategy_job_id','93000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','campaign.strategy.generate','succeeded',1,1,'{"contract_version":"phase3.campaign-strategist-job.v1"}','{"contract_version":"phase3.campaign-strategist-output.v1"}',statement_timestamp(),statement_timestamp()),
  ('$job_id','93000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','campaign.content.generate','waiting_approval',1,1,'{"contract_version":"phase3.content-producer-job.v1"}','{"contract_version":"phase3.content-producer-output.v1"}',statement_timestamp(),NULL);
UPDATE tanaghom.agents SET status='waiting_approval' WHERE id='10000000-0000-4000-8000-000000000002';
INSERT INTO tanaghom.content_items
  (id,campaign_id,strategy_id,channel,content_type,draft_copy,media_brief,status)
VALUES
  ('$content_one','20000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000021','instagram','post','First disposable draft.','First visual.','pending_approval'),
  ('$content_two','20000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000021','instagram','post','Second disposable draft.','Second visual.','pending_approval');
INSERT INTO tanaghom.outbox_events
  (correlation_id,event_key,event_type,aggregate_type,aggregate_id,payload)
VALUES
  ('93000000-0000-4000-8000-000000000031','content.generated:$job_id','content.generated','agent_job','$job_id','{"content_item_ids":["$content_one","$content_two"]}');
UPDATE tanaghom.campaigns SET status='awaiting_approval' WHERE id='20000000-0000-4000-8000-000000000001';
SQL

test "$(psql "$url" -X -q -v ON_ERROR_STOP=1 -At <<SQL
SET ROLE tanaghom_n8n_worker;
SELECT tanaghom.complete_content_job('$job_id');
RESET ROLE;
SQL
)" = f
test "$(scalar "SELECT status FROM tanaghom.agent_jobs WHERE id='$job_id';")" = waiting_approval
test "$(scalar "SELECT count(*) FROM tanaghom.agent_actions_log WHERE job_id='$job_id' AND action_type='content.review_completed';")" = 0
if operator preflight >/dev/null 2>&1; then echo 'preflight accepted unresolved content' >&2; exit 1; fi

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<SQL
SET ROLE tanaghom_api;
INSERT INTO tanaghom.content_approvals (content_item_id,decision,decided_by) VALUES ('$content_one','approved','00000000-0000-4000-8000-000000000001');
UPDATE tanaghom.content_items SET status='approved' WHERE id='$content_one';
RESET ROLE;
SQL
test "$(psql "$url" -X -q -v ON_ERROR_STOP=1 -At <<SQL
SET ROLE tanaghom_n8n_worker;
SELECT tanaghom.complete_content_job('$job_id');
RESET ROLE;
SQL
)" = f
test "$(scalar "SELECT status FROM tanaghom.agent_jobs WHERE id='$job_id';")" = waiting_approval

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<SQL
SET ROLE tanaghom_api;
INSERT INTO tanaghom.content_approvals (content_item_id,decision,decided_by) VALUES ('$content_two','approved','00000000-0000-4000-8000-000000000001');
UPDATE tanaghom.content_items SET status='approved' WHERE id='$content_two';
RESET ROLE;
SQL

psql "$url" -X -v ON_ERROR_STOP=1 -c "UPDATE tanaghom.app_users SET is_active=false WHERE id='00000000-0000-4000-8000-000000000001';" >/dev/null
if operator preflight >/dev/null 2>&1; then echo 'preflight accepted an inactive human reviewer' >&2; exit 1; fi
psql "$url" -X -v ON_ERROR_STOP=1 -c "UPDATE tanaghom.app_users SET is_active=true WHERE id='00000000-0000-4000-8000-000000000001';" >/dev/null

psql "$url" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO tanaghom.organizations (id,slug,name) VALUES ('93000000-0000-4000-8000-000000000099','other-test','Other Test');
UPDATE tanaghom.app_users SET organization_id='93000000-0000-4000-8000-000000000099' WHERE id='00000000-0000-4000-8000-000000000001';
SQL
if operator preflight >/dev/null 2>&1; then echo 'preflight accepted a cross-organization human reviewer' >&2; exit 1; fi
psql "$url" -X -v ON_ERROR_STOP=1 -c "UPDATE tanaghom.app_users SET organization_id='10000000-0000-4000-8000-000000000001' WHERE id='00000000-0000-4000-8000-000000000001';" >/dev/null

operator preflight >/dev/null
operator reconcile >"${TMPDIR:-/tmp}/tanaghom-disposable-reconciliation.json"
operator verify-complete >/dev/null
test "$(scalar "SELECT status||'|'||(finished_at IS NOT NULL)::text FROM tanaghom.agent_jobs WHERE id='$job_id';")" = 'succeeded|true'
test "$(scalar "SELECT status FROM tanaghom.agents WHERE id='10000000-0000-4000-8000-000000000002';")" = idle
test "$(scalar "SELECT count(*) FROM tanaghom.agent_actions_log WHERE job_id='$job_id' AND action_type='content.review_completed' AND result='success';")" = 1
test "$(scalar "SELECT count(*) FROM tanaghom.agent_jobs WHERE campaign_id='20000000-0000-4000-8000-000000000001' AND job_type NOT IN ('campaign.strategy.generate','campaign.content.generate');")" = 0
test "$(scalar 'SELECT count(*) FROM tanaghom.external_operations;')" = 0
if operator reconcile >/dev/null 2>&1; then echo 'repeated reconciliation unexpectedly succeeded' >&2; exit 1; fi
test "$(scalar "SELECT count(*) FROM tanaghom.agent_actions_log WHERE job_id='$job_id' AND action_type='content.review_completed';")" = 1
if psql "$url" -X -q -v ON_ERROR_STOP=1 -At >/dev/null 2>&1 <<SQL
SET ROLE tanaghom_n8n_worker;
SELECT tanaghom.complete_content_job('$job_id');
SQL
then echo 'completed function unexpectedly accepted a repeated call' >&2; exit 1; fi

rm -f "${TMPDIR:-/tmp}/tanaghom-disposable-reconciliation.json"
echo 'PASS: incomplete, inactive-reviewer, cross-organization, success, and repeated reconciliation paths are exact and idempotent.'
