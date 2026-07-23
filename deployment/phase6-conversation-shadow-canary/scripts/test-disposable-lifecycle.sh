#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
package="$root/deployment/phase6-conversation-shadow-canary"
url=${1:-${DATABASE_TEST_URL:-}}
test -n "$url" || { echo 'DATABASE_TEST_URL is required' >&2; exit 2; }
canary_id=conversationcanary-20260721T120000Z

psql_file() { psql "$url" -X -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
scalar() { psql "$url" -X -q -v ON_ERROR_STOP=1 -At -c "$1" | tr -d '\r'; }
for file in "$root"/packages/database/migrations/*.up.sql; do
  psql_file "$file"
  test "$(basename "$file")" = 0025_runtime_agent_reconciliation.up.sql && break
done
psql_file "$root/packages/database/seeds/staging.sql"
test "$(scalar 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1;')" = 0025_runtime_agent_reconciliation
test "$(scalar "WITH updated AS (UPDATE tanaghom.agent_workflow_registry SET runtime_state='imported_inactive',trigger_state='disabled',runtime_evidence='disposable-canary-baseline' WHERE code='conversation_intelligence_worker' RETURNING 1) SELECT count(*) FROM updated;")" = 1

operator() { DATABASE_URL="$url" node "$package/scripts/canary-operator.mjs" "$@"; }
operator check-database "$canary_id" >/dev/null
controls=$(operator snapshot-controls "$canary_id")
reason=$(printf '%s' "$controls" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).reason_base64))')
operator seed "$canary_id" >/dev/null
operator assert-only-canary "$canary_id" >/dev/null

# A competing connected integration must close the exclusive execution gate.
org=$(scalar "SELECT id FROM tanaghom.organizations WHERE slug='conversation-canary-20260721t120000z';")
owner=$(scalar "SELECT id FROM tanaghom.app_users WHERE organization_id='$org' AND role='owner';")
scalar "INSERT INTO tanaghom.organizations(slug,name) VALUES('competing-canary-test','Competing Canary Test') RETURNING id;" >/dev/null
competing_org=$(scalar "SELECT id FROM tanaghom.organizations WHERE slug='competing-canary-test';")
scalar "INSERT INTO tanaghom.app_users(email,display_name,kind,role,is_active,auth_subject,accepted_at,organization_id) VALUES('competing@conversation-canary.test','Competing Owner','human','owner',true,gen_random_uuid(),now(),'$competing_org') RETURNING id;" >/dev/null
competing_owner=$(scalar "SELECT id FROM tanaghom.app_users WHERE organization_id='$competing_org';")
scalar "INSERT INTO tanaghom.integration_connections(organization_id,provider,status,base_url,credential_kind,credential_ciphertext,credential_nonce,credential_auth_tag,credential_key_version,secret_last_four,configuration,configured_by) VALUES('$competing_org','ghl','connected','https://competing.invalid.test','private_token',decode('01','hex'),decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),1,'test','{\"location_id\":\"competing_location\"}','$competing_owner');" >/dev/null
if operator assert-only-canary "$canary_id" >/dev/null 2>&1; then echo 'operator accepted a competing connected GHL integration' >&2; exit 1; fi
scalar "UPDATE tanaghom.integration_connections SET status='disconnected',credential_ciphertext=NULL,credential_nonce=NULL,credential_auth_tag=NULL,credential_key_version=NULL,secret_last_four=NULL,disconnected_at=now() WHERE organization_id='$competing_org'; UPDATE tanaghom.app_users SET is_active=false WHERE organization_id='$competing_org'; UPDATE tanaghom.organizations SET is_active=false WHERE id='$competing_org';" >/dev/null
operator assert-only-canary "$canary_id" >/dev/null

operator unlock "$canary_id" >/dev/null
job=$(scalar "SELECT id FROM tanaghom.agent_jobs WHERE job_type='conversation.ghl.inbound_event' AND input->>'organization_id'='$org';")
event=$(scalar "SELECT id FROM tanaghom.ghl_inbound_events WHERE organization_id='$org';")
source_id=$(scalar "SELECT source.id FROM tanaghom.sales_knowledge_sources source WHERE source.organization_id='$org';")
version_id=$(scalar "SELECT version.id FROM tanaghom.sales_knowledge_versions version WHERE version.organization_id='$org' AND version.status='active';")
fingerprint=$(scalar "SELECT content_fingerprint FROM tanaghom.sales_knowledge_versions WHERE id='$version_id';")

psql "$url" -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
SET ROLE tanaghom_conversation_worker;
SELECT * FROM tanaghom.claim_ghl_inbound_event_job();
SELECT * FROM tanaghom.prepare_conversation_intelligence('$job');
SELECT tanaghom.persist_conversation_intelligence_proposal(
  '$job',
  jsonb_build_object(
    'contract_version','phase5.conversation-intelligence-output.v1',
    'prompt_version','phase5.conversation-intelligence.prompt.v1',
    'language','en','intent','pricing','urgency','normal','sentiment','neutral',
    'sales_stage','consideration','next_best_action','respond','confidence',0.95,
    'answer_status','proposal','proposed_reply','The approved Tanaghom Canary Growth plan price is USD 99 per month.',
    'citations',jsonb_build_array(jsonb_build_object(
      'source_id','$source_id','source_version_id','$version_id','content_fingerprint','$fingerprint'
    )),
    'risk_categories','[]'::jsonb,
    'escalation',jsonb_build_object('required',false,'category','','reason',''),
    'model_name','disposable-gemma-simulator','external_action_count',0
  )
);
RESET ROLE;
SQL

operator restore-locks "$canary_id" "$reason" >/dev/null
operator verify-ready "$canary_id" >/dev/null
operator finalize "$canary_id" >/dev/null
operator verify-finalized "$canary_id" >/dev/null
test "$(scalar "SELECT count(*) FROM tanaghom.conversation_intelligence_proposals WHERE organization_id='$org' AND external_action_count=0;")" = 1
test "$(scalar "SELECT count(*) FROM tanaghom.conversation_supervisor_inbox WHERE organization_id='$org' AND state='awaiting_approval';")" = 1
test "$(scalar 'SELECT count(*) FROM tanaghom.external_operations;')" = 0
test "$(scalar 'SELECT count(*) FROM tanaghom.ghl_action_jobs;')" = 0
echo 'PASS: exclusive seeding, competing-work refusal, claim, grounded proposal persistence, Supervisor Inbox handoff, final quarantine, and zero external actions passed in disposable PostgreSQL.'
