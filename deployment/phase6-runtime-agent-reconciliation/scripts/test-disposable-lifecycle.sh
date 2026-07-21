#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }
up="$root/packages/database/migrations/0025_runtime_agent_reconciliation.up.sql"
down="$root/packages/database/migrations/0025_runtime_agent_reconciliation.down.sql"
psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
scalar() { psql "$url" -X -q -v ON_ERROR_STOP=1 -At -c "$1" | tr -d '\r'; }

for file in "$root"/packages/database/migrations/*.up.sql; do
  test "$(basename "$file")" = 0025_runtime_agent_reconciliation.up.sql && break
  psql_file "$file"
done
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0024_conversation_intelligence_worker_registry
scalar "INSERT INTO tanaghom.agents(id,code,name,description,status) VALUES
  ('81000000-0000-4000-8000-000000000001','campaign_strategist','Campaign Strategist','Existing disposable strategy runtime agent.','idle'),
  ('81000000-0000-4000-8000-000000000002','content_producer','Content Producer','Existing disposable content runtime agent.','idle');" >/dev/null
before=$(scalar "SELECT md5(string_agg(id||'|'||code||'|'||name||'|'||description||'|'||status,E'\\n' ORDER BY code)) FROM tanaghom.agents;")
psql_file "$up"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0025_runtime_agent_reconciliation
test "$(scalar "SELECT count(*) FROM tanaghom.agents WHERE code IN ('campaign_strategist','content_producer','publisher_monitor','sales_crm');")" = 4
test "$(scalar "SELECT md5(string_agg(id||'|'||code||'|'||name||'|'||description||'|'||status,E'\\n' ORDER BY code)) FROM tanaghom.agents WHERE code IN ('campaign_strategist','content_producer');")" = "$before"

sales=10000000-0000-4000-8000-000000000004
scalar "INSERT INTO tanaghom.agent_jobs(id,correlation_id,agent_id,job_type,status,attempt,max_attempts,input,finished_at) VALUES(gen_random_uuid(),gen_random_uuid(),'$sales','runtime.reconciliation.history','cancelled',0,1,'{}',statement_timestamp());" >/dev/null
psql_file "$down"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0024_conversation_intelligence_worker_registry
test "$(scalar "SELECT count(*) FROM tanaghom.agents WHERE code='publisher_monitor';")" = 0
test "$(scalar "SELECT count(*) FROM tanaghom.agents WHERE id='$sales' AND code='sales_crm';")" = 1
scalar "DELETE FROM tanaghom.agent_jobs WHERE agent_id='$sales';" >/dev/null

psql_file "$up"
test "$(scalar "SELECT count(*) FROM tanaghom.agents WHERE code IN ('publisher_monitor','sales_crm');")" = 2
psql_file "$root/packages/database/seeds/staging.sql"
test "$(scalar "SELECT count(*) FROM tanaghom.agents WHERE code IN ('campaign_strategist','content_producer','publisher_monitor','sales_crm');")" = 4
echo 'PASS: migration 0025 adds missing runtime agents, preserves prior rows and used history, rolls back unused identities, reapplies, and remains staging-seed compatible.'
