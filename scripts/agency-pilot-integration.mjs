// Owns a uniquely named disposable stack. Never reads .env or DATABASE_URL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdtemp, writeFile, rm, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import pg from 'pg';
import { existingFixture } from '../tests/fixtures/agency-pilot.mjs';
import { fingerprint } from '../packages/agent-runtime/agency-pilot.mjs';
import { seedPilot, organizationId, ownerId, campaignId, modelId, codes } from '../tests/fixtures/agency-database.mjs';

const root=process.cwd(), suffix=`${process.pid}-${Date.now()}`, name=`tanaghom-agency-${suffix}`;
const postgresImage='postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const n8nImage='docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd';
const temporary=await mkdtemp(join(tmpdir(),'tanaghom-agency-'));
const token=randomBytes(32).toString('hex');
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>
  ['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA'].includes(k.toUpperCase())));
let pool, dashboard, dashboardOutput='', gemmaCalls=0, n8nExecutions=0;
const checks=[], journeys=[];
const pass=label=>{checks.push(label);console.log(`PASS: ${label}`);};
const run=(cmd,args,opts={})=>new Promise((res,rej)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe'],...opts});let out='';
  p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>out+=c);p.on('error',rej);p.on('close',c=>c===0?res(out.trim()):rej(new Error(`${cmd} failed: ${out.slice(-5000)}`)));});
const docker=(...a)=>run('docker',a);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'agency-disposable',alg:'RS256',use:'sig'};
const auth=createServer((req,res)=>{
  if(req.url!=='/auth/v1/.well-known/jwks.json')return res.writeHead(404).end();
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({keys:[jwk]}));
});
function modelResponse(request) {
  const input=JSON.parse(request.messages.at(-1).content);
  const language=input.provider_message?.language_hint || input.language || (request.messages[0].content.includes('Requested language: ar')?'ar':'en');
  let output;
  if(input.contract_version==='phase3.strategist-job.v1')output=existingFixture('social_media_strategist',language).output;
  else if(input.contract_version==='phase3.content-producer-job.v1')output=existingFixture('content_creator',language).output;
  else if(input.provider_message){
    output=existingFixture('support_responder',language).output;output.model_name=request.model;
    output.citations=input.retrieved_knowledge.map(k=>({source_id:k.source_id,source_version_id:k.source_version_id,content_fingerprint:k.content_fingerprint}));
    output.proposed_reply=input.retrieved_knowledge[0]?.content || null;
    output.conversation_summary.input_event_ids=[input.provider_message.event_id];
  }else output={language,findings:[],questions:[]};
  return {model:request.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:500,completion_tokens:200}};
}
const gemma=createServer(async(req,res)=>{
  if(req.url!=='/v1/chat/completions'||req.headers.authorization!==`Bearer ${token}`)return res.writeHead(403).end();
  const chunks=[];for await(const c of req)chunks.push(c);
  try { const request=JSON.parse(Buffer.concat(chunks));gemmaCalls++;
    assert(!JSON.stringify(request.response_format).includes('minProperties'));
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(modelResponse(request)));
  }catch {res.writeHead(400).end('{}');}
});
try {
  await docker('run','-d','--name',name,'--label',`tanaghom.disposable=${suffix}`,'--memory','512m','--cpus','1',
    '-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD=disposable-only',postgresImage);
  const port=(await docker('port',name,'5432/tcp')).split(':').at(-1);
  const databaseUrl=`postgresql://postgres:disposable-only@127.0.0.1:${port}/postgres`;
  pool=new pg.Pool({connectionString:databaseUrl,max:4});
  for(let i=0;;i++){try{await pool.query('SELECT 1');break;}catch(e){if(i>40)throw e;await delay(250);}}
  const files=(await readdir(join(root,'packages/database/migrations'))).filter(f=>f.endsWith('.up.sql')).sort();
  for(const f of files)await pool.query(await readFile(join(root,'packages/database/migrations',f),'utf8'));
  const down=await readFile(join(root,'packages/database/migrations/0034_agency_pilot_integration.down.sql'),'utf8');
  await pool.query(down);
  await pool.query(await readFile(join(root,'packages/database/migrations/0034_agency_pilot_integration.up.sql'),'utf8'));
  assert.equal((await pool.query('SELECT emergency_stop,model_execution_enabled FROM tanaghom.agency_pilot_controls')).rows[0].emergency_stop,true);
  pass('34 migrations apply; empty 0034 rollback and reapply preserve fail-closed defaults');
  await pool.query(await readFile(join(root,'packages/database/seeds/staging.sql'),'utf8'));
  const fixtures=await seedPilot(pool);
  await pool.query("ALTER ROLE tanaghom_api LOGIN PASSWORD 'disposable-only'; ALTER ROLE tanaghom_agency_pilot_worker LOGIN PASSWORD 'disposable-only'");
  const restricted=new pg.Pool({connectionString:databaseUrl.replace('postgres:disposable-only@','tanaghom_agency_pilot_worker:disposable-only@')});
  try {
    for(const sql of ['SELECT * FROM tanaghom.app_users','SELECT * FROM tanaghom.integration_connections',
      'UPDATE tanaghom.agency_pilot_controls SET emergency_stop=false','DELETE FROM tanaghom.agency_pilot_events',
      'SELECT * FROM tanaghom.content_items','SELECT * FROM tanaghom.agency_pilot_tasks'])await assert.rejects(()=>restricted.query(sql));
  }finally{await restricted.end();}
  pass('restricted worker cannot read raw tenant tables, credentials, approvals or mutate controls/audit');
  auth.listen(0,'127.0.0.1');gemma.listen(0,'0.0.0.0');await Promise.all([once(auth,'listening'),once(gemma,'listening')]);
  const authOrigin=`http://127.0.0.1:${auth.address().port}`;
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const dashboardPort=reservation.address().port;await new Promise(r=>reservation.close(r));
  const origin=`http://127.0.0.1:${dashboardPort}`;
  const authToken=async(subject='90000000-0000-4000-8000-000000000001')=>new SignJWT({role:'authenticated'})
    .setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(`${authOrigin}/auth/v1`).setAudience('authenticated')
    .setSubject(subject).setIssuedAt().setExpirationTime('30m').sign(privateKey);
  const ownerToken=await authToken();
  dashboard=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/dashboard','--hostname','0.0.0.0','--port',String(dashboardPort)],
    {env:{...cleanEnv,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',SUPABASE_URL:authOrigin,
      DATABASE_URL:databaseUrl.replace('postgres:disposable-only@','tanaghom_api:disposable-only@'),
      AGENCY_PILOT_DATABASE_URL:databaseUrl.replace('postgres:disposable-only@','tanaghom_agency_pilot_worker:disposable-only@'),
      AGENCY_PILOT_WORKER_TOKEN:token,AGENCY_PILOT_GATEWAY_ENABLED:'true'},stdio:['ignore','pipe','pipe']});
  dashboard.stdout.on('data',c=>dashboardOutput+=c);dashboard.stderr.on('data',c=>dashboardOutput+=c);
  for(let i=0;;i++){try{const r=await fetch(`${origin}/api/health`);if(r.ok)break;}catch{}if(i>50)throw new Error(dashboardOutput);await delay(300);}
  const request=async(path,body,credential=ownerToken,extra={})=>{
    const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(credential?{Authorization:`Bearer ${credential}`}:{ }),...extra},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:r.status,body:await r.json()};
  };
  const admin=(b,c=ownerToken,headers)=>request('/api/admin/agents/pilot',b,c,headers);
  const worker=(b,c=token)=>request('/api/internal/agency-pilot',b,c);
  assert.equal((await admin(undefined,null)).status,401);
  await pool.query("UPDATE tanaghom.app_users SET role='viewer' WHERE id=$1",[ownerId]);
  assert.equal((await admin()).status,403);
  await pool.query("UPDATE tanaghom.app_users SET role='owner' WHERE id=$1",[ownerId]);
  assert.equal((await worker({action:'claim'},'wrong')).status,401);
  assert.equal((await worker({action:'claim'},'é'.repeat(32))).status,401);
  assert.equal((await admin({action:'bind'},null,{Cookie:`tanaghom_access_token=${ownerToken}`,Origin:'https://untrusted.test'})).status,401);
  assert.equal((await admin({action:'queue',organization_id:randomUUID()})).status,400);
  const otherOrg=randomUUID(),otherUser=randomUUID(),otherSubject=randomUUID();
  await pool.query('INSERT INTO tanaghom.organizations(id,slug,name) VALUES($1,$2,$3)',[otherOrg,'agency-outsider','Outside Tenant']);
  await pool.query(`INSERT INTO tanaghom.app_users(id,email,display_name,kind,role,organization_id,auth_subject,accepted_at)
    VALUES($1,'outsider@example.test','Outside Owner','human','owner',$2,$3,now())`,[otherUser,otherOrg,otherSubject]);
  const otherToken=await authToken(otherSubject);
  assert.equal((await admin({action:'bind',agent_version_id:fixtures.versions.social_media_strategist,profile_code:'social_media_strategist'},otherToken)).status,409);
  const bindings={};
  for(const code of codes){const r=await admin({action:'bind',agent_version_id:fixtures.versions[code],profile_code:code});
    assert.equal(r.status,200,JSON.stringify(r));bindings[code]=r.body.id;}
  pass('real JWT/owner auth, cookie-origin guard, tenant isolation, closed commands and worker token checks');
  const evidence={en:[],ar:[]};
  const windowEnd=new Date(Date.now()-60000).toISOString(),windowStart=new Date(Date.now()-86400000).toISOString();
  for(const language of ['en','ar'])for(const [kind,record] of [
    ['brand_rule',{language,check:'required_phrase',phrase:language==='ar'?'دورة':'course',category:'tone',severity:'warning',correction:'Use approved wording.'}],
    ['metric',{metric_code:'drafts',definition_version:'agency.metrics.v1',window_start:windowStart,window_end:windowEnd,
      unit:'count',value:3,currency:null,numerator:null,denominator:null}],
  ]){
    const r=await admin({action:'approve_evidence',kind,record,expires_at:new Date(Date.now()+86400000).toISOString()});
    assert.equal(r.status,200,JSON.stringify(r));evidence[language].push(r.body.id);
  }
  const queued=async(code,language='en',key=randomUUID())=>{
    const command={action:'queue',binding_id:bindings[code],model_profile_id:modelId,language,
      target_id:code==='executive_summary'?null:code==='brand_guardian'?fixtures.contentId:
        ['discovery_coach','support_responder'].includes(code)?fixtures.events[language]:campaignId,
      options:code==='executive_summary'?{window_start:windowStart,window_end:windowEnd,metric_codes:['drafts','leads']}:{},
      evidence_ids:code==='brand_guardian'?[evidence[language][0]]:code==='executive_summary'?[evidence[language][1]]:[],idempotency_key:key};
    return {command,...await admin(command)};
  };
  assert.equal((await queued('social_media_strategist')).status,409);
  await pool.query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=false,model_execution_enabled=true; UPDATE tanaghom.agent_runtime_controls SET emergency_stop=false');
  const dockerHost=process.platform==='win32'?'host.docker.internal':'127.0.0.1';
  const workflow=JSON.parse(await readFile(join(root,'n8n/workflows/agency-pilot/simulation.v1.json'),'utf8'));
  assert.equal(workflow.active,false);assert(workflow.nodes.find(n=>n.type==='n8n-nodes-base.scheduleTrigger').disabled);
  for(const n of workflow.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest'))n.parameters.url=n.name==='Fixed Gemma Request'
    ?`http://${dockerHost}:${gemma.address().port}/v1/chat/completions`:`http://${dockerHost}:${dashboardPort}/api/internal/agency-pilot`;
  const creds=[{id:'agencyPilotGatewayV1',name:'Tanaghom Agency Pilot Gateway',type:'httpHeaderAuth',data:{name:'Authorization',value:`Bearer ${token}`}},
    {id:'62000000-0000-4000-8000-000000000002',name:'Tanaghom Gemma API',type:'httpHeaderAuth',data:{name:'Authorization',value:`Bearer ${token}`}}];
  await writeFile(join(temporary,'workflow.json'),JSON.stringify(workflow));await writeFile(join(temporary,'credentials.json'),JSON.stringify(creds));
  await chmod(temporary,0o755);for(const f of ['workflow.json','credentials.json'])await chmod(join(temporary,f),0o644);
  await docker('volume','create','--label',`tanaghom.disposable=${suffix}`,name);
  const dockerArgs=['run','--rm','--name',`${name}-worker`,'--network','host','--memory','1536m','--cpus','2',
    '-e',`N8N_ENCRYPTION_KEY=${token}`,'-e','N8N_DIAGNOSTICS_ENABLED=false','-e','N8N_VERSION_NOTIFICATIONS_ENABLED=false',
    '-e','N8N_SSRF_PROTECTION_ENABLED=false','-e','N8N_BLOCK_ENV_ACCESS_IN_NODE=true',
    '-v',`${name}:/home/node/.n8n`,'-v',`${temporary}:/fixtures:ro`,n8nImage];
  await docker(...dockerArgs,'import:credentials','--input=/fixtures/credentials.json');
  await docker(...dockerArgs,'import:workflow','--input=/fixtures/workflow.json','--activeState=false');
  pass('pinned n8n import inactive; disabled schedule; only disposable URLs and credentials');
  for(const language of ['en','ar'])for(const code of codes){
    const q=await queued(code,language);assert.equal(q.status,200,JSON.stringify(q));
    assert.equal((await admin(q.command)).body.id,q.body.id);
    assert.equal((await admin({...q.command,language:language==='en'?'ar':'en'})).status,409);
    const out=await docker(...dockerArgs,'execute','--id=agencyPilotSimulationV1','--rawOutput');n8nExecutions++;
    const task=(await pool.query('SELECT * FROM tanaghom.agency_pilot_tasks WHERE id=$1',[q.body.id])).rows[0];
    assert.equal(task.status,'succeeded',`${code}/${language}: ${task.error_code}\n${out.slice(-2500)}`);
    assert.equal(task.result.external_action_count,0);assert.equal(task.result.human_approval_granted,false);
    journeys.push({code,language,result:'PASS',response_hash:task.response_hash,result_hash:fingerprint(task.result)});pass(`${code}/${language}: n8n → authenticated gateway → durable validated result`);
  }
  const q=await queued('social_media_strategist');assert.equal(q.status,200);
  const claim=(await worker({action:'claim'})).body.task;assert.equal(claim.task_id,q.body.id);
  assert.equal((await worker({action:'claim'})).body.task,null);
  const response=modelResponse(claim.request);
  assert.equal((await worker({action:'complete',task_id:claim.task_id,lease_token:randomUUID(),model_response:response})).status,409);
  const complete={action:'complete',task_id:claim.task_id,lease_token:claim.lease_token,model_response:response};
  assert.equal((await worker(complete)).body.status,'succeeded');assert.equal((await worker(complete)).body.replay,true);
  assert.equal((await worker({...complete,model_response:{...response,untrusted:true}})).status,409);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM tanaghom.agency_pilot_events WHERE task_id=$1 AND event_type='succeeded'",[q.body.id])).rows[0].n,1);
  await assert.rejects(()=>pool.query('UPDATE tanaghom.agency_pilot_tasks SET result=$2 WHERE id=$1',[q.body.id,{}]),/immutable/);
  pass('exclusive lease, wrong-lease refusal, queue/completion replay, conflict rejection, one immutable completion');
  for(const mutation of ['campaign_edit','evidence_revoke','human_takeover','dnd','emergency_stop','invalid_json']){
    const code=mutation==='evidence_revoke'?'brand_guardian':['human_takeover','dnd'].includes(mutation)?'support_responder':'social_media_strategist';
    const q=await queued(code);assert.equal(q.status,200,JSON.stringify(q));const c=(await worker({action:'claim'})).body.task;assert(c,mutation);
    const res=modelResponse(c.request);
    if(mutation==='campaign_edit')await pool.query("UPDATE tanaghom.campaigns SET brief=brief||' Changed after claim.' WHERE id=$1",[campaignId]);
    if(mutation==='evidence_revoke')assert.equal((await admin({action:'revoke_evidence',evidence_id:evidence.en[0]})).status,200);
    if(mutation==='human_takeover')await pool.query("UPDATE tanaghom.conversations SET state='human_owned',reply_authority='human',owner_user_id=$1 WHERE provider_conversation_id='pilot-conversation-en'",[ownerId]);
    if(mutation==='dnd')await pool.query("UPDATE tanaghom.ghl_contact_channel_policies SET consent_status='dnd' WHERE contact_id='pilot-contact-en'");
    if(mutation==='emergency_stop')await pool.query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=true');
    if(mutation==='invalid_json')res.choices[0].message.content='not-json';
    assert.equal((await worker({action:'complete',task_id:c.task_id,lease_token:c.lease_token,model_response:res})).body.status,'failed',mutation);
    if(mutation==='human_takeover')await pool.query("UPDATE tanaghom.conversations SET state='queued',reply_authority='none',owner_user_id=NULL WHERE provider_conversation_id='pilot-conversation-en'");
    if(mutation==='dnd')await pool.query("UPDATE tanaghom.ghl_contact_channel_policies SET consent_status='opted_in' WHERE contact_id='pilot-contact-en'");
    if(mutation==='emergency_stop')await pool.query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=false');
    pass(`${mutation}: post-inference revalidation fails closed with retained audit`);
  }
  const outside=await admin(undefined,otherToken);assert.equal(outside.body.tasks.length,0);assert.equal(outside.body.bindings.length,0);
  const listed=await admin();assert(!JSON.stringify(listed.body).includes('lease_token'));
  assert(listed.body.tasks.every(t=>!Object.hasOwn(t,'prepared')));
  // Force only disposable task lease clocks; never alter immutable task identity.
  const recovery=await queued('social_media_strategist');const first=(await worker({action:'claim'})).body.task;
  await pool.query("UPDATE tanaghom.agency_pilot_tasks SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[recovery.body.id]);
  const recovered=(await worker({action:'claim'})).body.task;assert.equal(recovered.task_id,first.task_id);assert.notEqual(recovered.lease_token,first.lease_token);
  assert.equal((await worker({action:'complete',task_id:first.task_id,lease_token:first.lease_token,model_response:modelResponse(first.request)})).status,409);
  assert.equal((await worker({action:'complete',task_id:recovered.task_id,lease_token:recovered.lease_token,model_response:modelResponse(recovered.request)})).body.status,'succeeded');
  const exhausted=await queued('social_media_strategist');await worker({action:'claim'});
  await pool.query("UPDATE tanaghom.agency_pilot_tasks SET attempt=3,lease_expires_at=now()-interval '1 second' WHERE id=$1",[exhausted.body.id]);
  assert.equal((await worker({action:'claim'})).body.task,null);
  assert.equal((await pool.query('SELECT status FROM tanaghom.agency_pilot_tasks WHERE id=$1',[exhausted.body.id])).rows[0].status,'failed');
  pass('expired-lease recovery invalidates old token; exhausted retries retain one terminal failure');
  await docker(...dockerArgs,'export:workflow','--all','--output=/home/node/.n8n/pilot-export.json');
  const exported=JSON.parse(await docker('run','--rm','--network','none','--entrypoint','cat','-v',`${name}:/home/node/.n8n:ro`,n8nImage,'/home/node/.n8n/pilot-export.json'));
  assert.equal(exported.length,1);assert.equal(exported[0].active,false);
  assert(exported[0].nodes.find(n=>n.type==='n8n-nodes-base.scheduleTrigger').disabled);
  pass('actual n8n database export still inactive with polling disabled after manual executions');
  assert((await docker(...dockerArgs,'audit')).length>0);
  await assert.rejects(()=>pool.query(down),/rollback refused/);await pool.query('ROLLBACK');
  for(const table of ['postiz_provider_operations','ghl_provider_operations']){
    const exists=(await pool.query("SELECT to_regclass($1) AS name",[`tanaghom.${table}`])).rows[0].name;
    if(exists)assert.equal((await pool.query(`SELECT count(*)::int AS n FROM tanaghom.${table}`)).rows[0].n,0);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM tanaghom.agent_jobs WHERE job_type IN ('content.postiz.draft','lead.ghl.contact_upsert','ghl.action.execute')")).rows[0].n,0);
  await pool.query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=true,model_execution_enabled=false; UPDATE tanaghom.agent_runtime_controls SET emergency_stop=true');
  assert.equal((await worker({action:'claim'})).body.task,null);
  pass('tenant-scoped result history, retained-state rollback refusal, zero external-action jobs and restored stops');
  const evidenceReport={contract_version:'phase7.agency-integration-evidence.v1',result:'PASS',generated_at:new Date().toISOString(),
    baseline:'0034_agency_pilot_integration',postgres_image:postgresImage,n8n_image:n8nImage,checks,journeys,
    actual_n8n_manual_executions:n8nExecutions,simulated_model_http_calls:gemmaCalls,real_model_calls:0,provider_calls:0,
    production_connections:0,quality_certified:false,production_installed:false};
  await mkdir(join(root,'tmp'),{recursive:true});await writeFile(join(root,'tmp/agency-pilot-integration-evidence.json'),JSON.stringify(evidenceReport,null,2)+'\n');
  console.log(`PASS: ${checks.length} check groups, ${journeys.length} database/n8n journeys; evidence: tmp/agency-pilot-integration-evidence.json`);
}finally{
  if(dashboard){dashboard.kill();await Promise.race([once(dashboard,'exit').catch(()=>{}),delay(4000)]);}
  auth.closeAllConnections();gemma.closeAllConnections();auth.close();gemma.close();
  if(pool)await pool.end();
  await docker('rm','-f',`${name}-worker`).catch(()=>{});await docker('rm','-f',name).catch(()=>{});
  await docker('volume','rm',name).catch(()=>{});
  const target=resolve(temporary);assert(target.startsWith(resolve(tmpdir())+sep)&&target.split(sep).at(-1).startsWith('tanaghom-agency-'));
  await rm(target,{recursive:true,force:true});
}
