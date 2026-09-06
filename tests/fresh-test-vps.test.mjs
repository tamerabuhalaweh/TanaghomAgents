import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../deployment/fresh-test-vps/',import.meta.url);
test('fresh test deployment retains private database, digest pins and fail-closed runtime',async()=>{
 const source=await readFile(new URL('compose.yml',root),'utf8');
 assert.match(source,/name: tanaghom-test/);
 assert.match(source,/POSTGRES_DB: tanaghom_test/);
 assert.equal((source.match(/@sha256:[a-f0-9]{64}/g)??[]).length,2);
 assert.match(source,/database: \{ internal: true \}/);
 assert.equal((source.match(/ports:/g)??[]).length,1);
 assert.match(source,/ports: \["80:80", "443:443"\]/);
 assert.doesNotMatch(source,/supabase_secret_key|OPENAI_API_KEY|host\.docker\.internal|network_mode: host/);
 for(const flag of ['AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED','AGENCY_PILOT_GATEWAY_ENABLED','POSTIZ_HANDOFF_ENABLED','POSTIZ_AUTOMATION_RUNTIME_READY','POSTIZ_PERFORMANCE_SYNC_ENABLED','GHL_CONTACT_SYNC_ENABLED','GHL_CONTACT_HANDOFF_ENABLED','GHL_WEBHOOK_INGRESS_ENABLED','GHL_ACTION_RUNTIME_ENABLED','GHL_ACTION_RUNTIME_READY','ALLOW_STAGING_PUBLISH'])assert.ok(source.includes(`${flag}: "false"`));
 assert.match(source,/APP_ENV: production/);
 assert.match(source,/TANAGHOM_RELEASE:\?exact source revision required/);
 // Commas split unquoted YAML flow-list scalars into separate mounts.
 for(const size of ['64m','32m'])assert.ok(source.includes(`tmpfs: ["/tmp:size=${size},mode=1777"]`));
 for(const script of ['deploy.sh','validate.sh']){
  const shell=await readFile(new URL(script,root),'utf8');
  assert.match(shell,/config --format json \| python3 deployment\/fresh-test-vps\/validate-compose\.py/);
 }
 const seed=await readFile(new URL('bootstrap-owner.sql',root),'utf8');
 assert.match(seed,/current_database\(\) <> 'tanaghom_test'/);
 assert.match(seed,/refuse reseeding a database with users/);
 assert.doesNotMatch(seed,/fad025bc|tamer\.abuhalaweh|INSERT INTO tanaghom\.campaign/);
 const runbook=await readFile(new URL('RUNBOOK.md',root),'utf8');
 assert.match(runbook,/stop caddy dashboard postgres/);
 assert.match(runbook,/NOT an outbound allowlist/);
 assert.match(runbook,/not guaranteed permanent/);
});
