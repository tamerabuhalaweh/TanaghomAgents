// Disposable authenticated comparison integration. No production or real-model mode.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir,mkdtemp,writeFile,rm,chmod,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import pg from 'pg';
import {corpus,verifyLock} from './agency-quality-preparation.mjs';
import {fingerprint} from '../packages/agent-runtime/agency-pilot.mjs';
import {buildSchedule} from '../evaluation/agency-runner-v1/runtime.mjs';
import {createQualityGateway} from '../evaluation/agency-runner-v1/gateway.mjs';
import {seedQuality,importCase,stubResponse,ownerId,organizationId,codes} from '../evaluation/agency-runner-v1/fixtures.mjs';
import {buildWorkflow} from '../evaluation/agency-runner-v1/workflow.mjs';
import {verifyRunnerLock} from '../evaluation/agency-runner-v1/manifest.mjs';

assert.equal(process.argv.length,2,'No live flags or external connection configuration accepted');verifyLock();
const sourceLock=verifyRunnerLock();
const root=process.cwd(),nonce=randomBytes(6).toString('hex'),name=`tanaghom-quality-${nonce}`,dbName=`tanaghom_quality_${nonce}`;
const images={postgres:'postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94',
  n8n:'docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd'};
const temporary=await mkdtemp(join(tmpdir(),'tanaghom-quality-')),token=randomBytes(32).toString('hex');
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA'].includes(k.toUpperCase())));
const run=(cmd,args,opts={})=>new Promise((yes,no)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe'],...opts});let out='',errors='',head='';
  p.stdout.on('data',c=>{out=(out+c).slice(-20000);head=(head+c).slice(0,4000)});p.stderr.on('data',c=>{errors=(errors+c).slice(-4000)});p.on('error',no);p.on('close',(c,signal)=>c===0?yes(out.trim()):no(new Error(`${cmd} exit ${c}, signal ${signal}: ${errors.slice(-1500)} ${head.slice(0,2200)}`)));});
const docker=(...a)=>run('docker',a),delay=ms=>new Promise(r=>setTimeout(r,ms));
const listen=async(s,host='0.0.0.0')=>{s.listen(0,host);await once(s,'listening');return s.address().port;};
const pass=s=>{checks.push(s);console.log(`PASS: ${s}`);};
let pool,restricted,dashboard,gateway,auth,model,output='',fixtures,admin,worker,autoQueue=false,position=0,batchEnd=0,lastTask=null,workflowExecutions=0;
const checks=[],attemptIds=[],conditions=new Map(),preparedRecords=[],modelRecords=[],failures=[];
const schedule=buildSchedule(),runId=randomUUID();
const manifest={version:'agency.isolated-comparison-run.v1',kind:'simulated_model',runner_source_lock_hash:fingerprint(sourceLock),corpus_hash:fingerprint(corpus),
  schedule_hash:fingerprint(schedule),repetitions:3,maximum_attempts:400,maximum_batch_attempts:30,images};
const manifestHash=fingerprint(manifest);
let evidence={version:'agency.isolated-comparison-evidence.v1',generated_at:new Date().toISOString(),run_id:runId,manifest_hash:manifestHash,
  result:'FAIL',quality_certified:false,review_scores:null,real_model_calls:0,provider_calls:0,production_connections:0};
try{
  await docker('volume','create','--label',`tanaghom.disposable=${nonce}`,`${name}-pgdata`);
  await docker('run','-d','--name',name,'--label',`tanaghom.disposable=${nonce}`,'--cpus','1','--memory','512m',
    '-p','127.0.0.1::5432','-v',`${name}-pgdata:/var/lib/postgresql/data`,'-e','POSTGRES_PASSWORD=disposable-only','-e',`POSTGRES_DB=${dbName}`,images.postgres);
  const port=(await docker('port',name,'5432/tcp')).split(':').at(-1),databaseUrl=`postgresql://postgres:disposable-only@127.0.0.1:${port}/${dbName}`;
  pool=new pg.Pool({connectionString:databaseUrl,max:4});
  for(let i=0;;i++){try{await pool.query('SELECT 1');break;}catch(e){if(i>50)throw e;await delay(250);}}
  for(const file of (await readdir(join(root,'packages/database/migrations'))).filter(f=>f.endsWith('.up.sql')).sort())await pool.query(await readFile(join(root,'packages/database/migrations',file),'utf8'));
  await pool.query(await readFile(join(root,'evaluation/agency-runner-v1/isolated.sql'),'utf8'));
  await pool.query(await readFile(join(root,'packages/database/seeds/staging.sql'),'utf8'));
  fixtures=await seedQuality(pool);
  await pool.query("ALTER ROLE tanaghom_api LOGIN PASSWORD 'disposable-only'; ALTER ROLE tanaghom_agency_pilot_worker LOGIN PASSWORD 'disposable-only'");
  restricted=new pg.Pool({connectionString:databaseUrl.replace('postgres:disposable-only@','tanaghom_agency_pilot_worker:disposable-only@'),max:2});
  for(const sql of ['SELECT * FROM tanaghom.app_users','SELECT * FROM tanaghom.integration_connections','SELECT * FROM tanaghom_quality.attempts',
    'DELETE FROM tanaghom_quality.stops','UPDATE tanaghom.agency_pilot_controls SET emergency_stop=false'])await assert.rejects(()=>restricted.query(sql));
  await assert.rejects(()=>createQualityGateway({pool,token,manifestHash}),/Restricted worker/);
  pass('34 original migrations unchanged; isolated-only registration schema; restricted role cannot read tables or mutate controls');
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'quality-disposable',alg:'RS256',use:'sig'};
  auth=createServer((req,res)=>{if(req.url!=='/auth/v1/.well-known/jwks.json')return res.writeHead(404).end();res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({keys:[jwk]}));});
  const authOrigin=`http://127.0.0.1:${await listen(auth,'127.0.0.1')}`;
  const jwt=subject=>new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(`${authOrigin}/auth/v1`).setAudience('authenticated').setSubject(subject).setIssuedAt().setExpirationTime('30m').sign(privateKey);
  const ownerToken=await jwt('90000000-0000-4000-8000-000000000001');
  const reservation=createServer(),dashboardPort=await listen(reservation,'127.0.0.1');await new Promise(r=>reservation.close(r));
  const origin=`http://127.0.0.1:${dashboardPort}`;
  dashboard=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/dashboard','--hostname','127.0.0.1','--port',String(dashboardPort)],
    {env:{...cleanEnv,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',SUPABASE_URL:authOrigin,
      DATABASE_URL:databaseUrl.replace('postgres:disposable-only@','tanaghom_api:disposable-only@'),AGENCY_PILOT_GATEWAY_ENABLED:'true'},stdio:['ignore','pipe','pipe']});
  dashboard.stdout.on('data',c=>output=(output+c).slice(-5000));dashboard.stderr.on('data',c=>output=(output+c).slice(-5000));
  for(let i=0;;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i>60)throw new Error(output);await delay(250);}
  admin=async(command,credential=ownerToken,headers={})=>{
    const r=await fetch(origin+'/api/admin/agents/pilot',{method:command===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(credential?{Authorization:`Bearer ${credential}`} :{}),...headers},...(command===undefined?{}:{body:JSON.stringify(command)})});
    return {status:r.status,body:await r.json()};
  };
  assert.equal((await admin(undefined,null)).status,401);
  await pool.query("UPDATE tanaghom.app_users SET role='viewer' WHERE id=$1",[ownerId]);assert.equal((await admin()).status,403);
  await pool.query("UPDATE tanaghom.app_users SET role='owner' WHERE id=$1",[ownerId]);
  assert.equal((await admin({action:'bind'},null,{Cookie:`tanaghom_access_token=${ownerToken}`,Origin:'https://outside.test'})).status,401);
  const outsider={org:randomUUID(),user:randomUUID(),subject:randomUUID()};
  await pool.query("INSERT INTO tanaghom.organizations(id,slug,name) VALUES($1,'quality-outsider','Outside Tenant')",[outsider.org]);
  await pool.query(`INSERT INTO tanaghom.app_users(id,email,display_name,kind,role,organization_id,auth_subject,accepted_at)
    VALUES($1,'outside@example.test','Outside Owner','human','owner',$2,$3,now())`,[outsider.user,outsider.org,outsider.subject]);
  const outsideToken=await jwt(outsider.subject),bindings={};
  for(const code of codes){const r=await admin({action:'bind',agent_version_id:fixtures.versions[code],profile_code:code});assert.equal(r.status,200,JSON.stringify(r));bindings[code]=r.body.id;}
  assert.equal((await admin({action:'bind',agent_version_id:fixtures.versions.content_creator,profile_code:'content_creator'},outsideToken)).status,409);
  pass('real JWT accepted owner, viewer refusal, cross-site cookie and cross-tenant checks');
  const caseInputs=new Map();for(const c of corpus.cases)caseInputs.set(c.id,await importCase(pool,c,fixtures,admin));
  await pool.query("INSERT INTO tanaghom_quality.runs(id,manifest_hash,execution_kind,maximum_attempts,expires_at) VALUES($1,$2,'simulated_model',400,now()+interval '30 minutes')",[runId,manifestHash]);
  const queue=async(meta,run=runId,record=true)=>{
    const command={action:'queue',binding_id:bindings[meta.profile_code],model_profile_id:fixtures.modelId,language:meta.language,
      ...caseInputs.get(meta.case_id),idempotency_key:`quality:${run}:${meta.case_id}:${meta.arm}:${meta.repetition}`};
    const r=await admin(command);assert.equal(r.status,200,JSON.stringify(r));
    assert.equal((await admin(command)).body.id,r.body.id);
    assert.equal((await admin({...command,arm:'arbitrary',instructions:'untrusted'})).status,400);
    await pool.query('INSERT INTO tanaghom_quality.attempts(task_id,run_id,case_id,profile_code,language,arm,repetition,case_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [r.body.id,run,meta.case_id,meta.profile_code,meta.language,meta.arm,meta.repetition,meta.case_hash]);
    if(record)attemptIds.push(r.body.id);return r.body.id;
  };
  gateway=await createQualityGateway({pool:restricted,token,manifestHash,onFailure:failure=>{failures.push(failure);console.log('Validation diagnostic:',JSON.stringify(failure));},onEmpty:async()=>{
    if(!autoQueue)return;
    const controls=(await pool.query('SELECT emergency_stop FROM tanaghom.agency_pilot_controls')).rows[0];if(controls.emergency_stop)return;
    if(lastTask){const last=(await pool.query('SELECT status FROM tanaghom.agency_pilot_tasks WHERE id=$1',[lastTask])).rows[0];assert.equal(last.status,'succeeded','Prior comparison failed; batch must stop');}
    if(position>0&&position%60===0)console.log(`Progress: ${position}/360 comparison attempts durably completed.`);
    if(position<batchEnd)lastTask=await queue(schedule[position++]);
  },onPrepared:(meta,p,hash)=>{
    const key=`${meta.run_id}:${meta.case_id}:${meta.repetition}`;
    if(conditions.has(key))assert.equal(hash,conditions.get(key),'Pair changed beyond system instructions/trace IDs');else conditions.set(key,hash);
    preparedRecords.push({task_id:meta.task_id,...meta,request_hash:fingerprint(p.request),condition_hash:hash});
  }});
  const gatewayPort=await listen(gateway);
  worker=async(command,credential=token)=>{const r=await fetch(`http://127.0.0.1:${gatewayPort}/quality/worker`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential}`},body:JSON.stringify(command)});return {status:r.status,body:await r.json()};};
  assert.equal((await worker({action:'claim'},'wrong')).status,401);assert.equal((await worker({action:'claim'},'é'.repeat(32))).status,401);
  assert.equal((await worker({action:'claim',arm:'baseline'})).status,400);assert.equal((await worker({action:'claim',url:'https://provider.test'})).status,400);
  assert.equal((await worker({action:'claim'})).body.task,null);
  await pool.query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=false,model_execution_enabled=true; UPDATE tanaghom.agent_runtime_controls SET emergency_stop=false,max_global_concurrency=1');
  model=createServer(async(req,res)=>{
    if(req.url!=='/v1/chat/completions'||req.headers.authorization!==`Bearer ${token}`)return res.writeHead(403).end();
    try{const chunks=[];let size=0;for await(const c of req){size+=c.length;assert(size<=200000);chunks.push(c);}
      const request=JSON.parse(Buffer.concat(chunks)),start=performance.now(),response=stubResponse(request);
      modelRecords.push({request_hash:fingerprint(request),response_hash:fingerprint(response),simulator_handler_ms:performance.now()-start});
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(response));
    }catch{res.writeHead(400).end('{}');}
  });
  const modelPort=await listen(model),host=process.platform==='win32'?'host.docker.internal':'127.0.0.1';
  const workflow=buildWorkflow(`http://${host}:${gatewayPort}/quality/worker`,`http://${host}:${modelPort}/v1/chat/completions`);
  const credentials=[{id:'agencyPilotGatewayV1',name:'Tanaghom Agency Pilot Gateway',type:'httpHeaderAuth',data:{name:'Authorization',value:`Bearer ${token}`}},
    {id:'62000000-0000-4000-8000-000000000002',name:'Tanaghom Gemma API',type:'httpHeaderAuth',data:{name:'Authorization',value:`Bearer ${token}`}}];
  await writeFile(join(temporary,'workflow.json'),JSON.stringify(workflow));await writeFile(join(temporary,'credentials.json'),JSON.stringify(credentials));
  await chmod(temporary,0o755);for(const f of ['workflow.json','credentials.json'])await chmod(join(temporary,f),0o644);
  await docker('volume','create','--label',`tanaghom.disposable=${nonce}`,`${name}-n8n`);
  const args=['run','--rm','--name',`${name}-worker`,'--network','host','--memory','1536m','--cpus','2','-e',`N8N_ENCRYPTION_KEY=${token}`,
    '-e','N8N_DIAGNOSTICS_ENABLED=false','-e','N8N_VERSION_NOTIFICATIONS_ENABLED=false','-e','N8N_SSRF_PROTECTION_ENABLED=false',
    '-e','N8N_BLOCK_ENV_ACCESS_IN_NODE=true','-v',`${name}-n8n:/home/node/.n8n`,'-v',`${temporary}:/fixtures:ro`,images.n8n];
  await docker(...args,'import:credentials','--input=/fixtures/credentials.json');await docker(...args,'import:workflow','--input=/fixtures/workflow.json','--activeState=false');
  autoQueue=true;
  while(position<schedule.length){
    batchEnd=Math.min(position+30,schedule.length);
    await docker(...args,'execute','--id=agencyQualityIsolatedV1');workflowExecutions++;
    assert.equal(position,batchEnd,'Incomplete batch cannot silently advance');
  }
  autoQueue=false;
  assert.equal(position,360);assert.equal(modelRecords.length,324);assert.equal(attemptIds.length,360);
  const tasks=(await pool.query(`SELECT a.*,t.status,t.result,t.error_code,t.response_hash,
    extract(epoch FROM (t.finished_at-t.claimed_at))*1000 AS gateway_roundtrip_ms
    FROM tanaghom_quality.attempts a JOIN tanaghom.agency_pilot_tasks t ON t.id=a.task_id WHERE a.run_id=$1 ORDER BY a.case_id,a.repetition,a.arm`,[runId])).rows;
  assert.equal(tasks.length,360);
  for(const t of tasks){assert.equal(t.status,'succeeded',`${t.case_id}: ${t.error_code}`);assert.equal(t.result.external_action_count,0);assert.equal(t.result.human_approval_granted,false);
    assert.equal(t.result.comparison.arm,t.arm);if(t.arm==='baseline')assert.equal(t.result.generation_procedure_hash,null);}
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM tanaghom.agency_pilot_events WHERE event_type='succeeded'")).rows[0].n,360);
  pass('360 actual n8n/PG attempts: 324 simulated model HTTP calls + 36 deterministic reports; 144 equal-condition pairs');
  const first=tasks[0],lease=(await pool.query('SELECT lease_token,prepared FROM tanaghom.agency_pilot_tasks WHERE id=$1',[first.task_id])).rows[0];
  const response=lease.prepared.request?stubResponse(lease.prepared.request):null;
  const completion={action:'complete',task_id:first.task_id,lease_token:lease.lease_token,model_response:response};
  assert.equal((await worker(completion)).body.replay,true);assert.equal((await worker({...completion,lease_token:randomUUID()})).status,409);
  assert.equal((await worker({...completion,model_response:{changed:true}})).status,409);
  await assert.rejects(()=>pool.query("UPDATE tanaghom_quality.attempts SET arm='adapted' WHERE task_id=$1",[first.task_id]),/immutable/i);
  await assert.rejects(()=>pool.query('DELETE FROM tanaghom_quality.runs WHERE id=$1',[runId]),/immutable/i);
  pass('one immutable completion per attempt; same-result replay, conflicting replay, wrong lease and relabeling rejected');
  for(const kind of ['invalid_json','model_identity','stale_campaign','dnd','takeover','run_stop']){
    const extraRun=randomUUID();await pool.query("INSERT INTO tanaghom_quality.runs(id,manifest_hash,execution_kind,maximum_attempts,expires_at) VALUES($1,$2,'simulated_model',1,now()+interval '5 minutes')",[extraRun,manifestHash]);
    const m={...schedule.find(s=>s.profile_code===(['dnd','takeover'].includes(kind)?'support_responder':'social_media_strategist'))};
    const task=await queue(m,extraRun,false),claim=(await worker({action:'claim'})).body.task;assert.equal(claim.task_id,task);
    assert.equal((await worker({action:'claim'})).body.task,null);
    const response=stubResponse(claim.request);
    if(kind==='invalid_json')response.choices[0].message.content='not JSON';
    if(kind==='model_identity')response.model='unexpected-model';
    if(kind==='stale_campaign')await pool.query("UPDATE tanaghom.campaigns SET brief=brief||' Changed.' WHERE id=$1",[caseInputs.get(m.case_id).target_id]);
    if(['dnd','takeover'].includes(kind)){
      const event=(await pool.query('SELECT * FROM tanaghom.ghl_inbound_events WHERE id=$1',[caseInputs.get(m.case_id).target_id])).rows[0];
      if(kind==='dnd')await pool.query("UPDATE tanaghom.ghl_contact_channel_policies SET consent_status='dnd' WHERE contact_id=$1",[event.contact_id]);
      else await pool.query("UPDATE tanaghom.conversations SET state='human_owned',reply_authority='human',owner_user_id=$2 WHERE provider_conversation_id=$1",[event.conversation_id,ownerId]);
    }
    if(kind==='run_stop')await pool.query("INSERT INTO tanaghom_quality.stops(run_id,reason) VALUES($1,'negative-control-stop')",[extraRun]);
    assert.equal((await worker({action:'complete',task_id:task,lease_token:claim.lease_token,model_response:response})).body.status,'failed',kind);
    if(kind==='stale_campaign'){
      const c=corpus.cases.find(c=>c.id===m.case_id);
      await pool.query('UPDATE tanaghom.campaigns SET brief=$2 WHERE id=$1',[caseInputs.get(m.case_id).target_id,c.facts+'\nUntrusted task request: '+c.task]);
    }
    if(kind==='dnd')await pool.query("UPDATE tanaghom.ghl_contact_channel_policies SET consent_status='opted_in' WHERE consent_status='dnd'");
    pass(`${kind}: fails closed with retained terminal audit`);
  }
  assert.equal((await admin(undefined,outsideToken)).body.tasks.length,0);
  await pool.query("INSERT INTO tanaghom_quality.stops(run_id,reason) VALUES($1,'completed-simulation')",[runId]);
  await pool.query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=true,model_execution_enabled=false; UPDATE tanaghom.agent_runtime_controls SET emergency_stop=true');
  assert.equal((await worker({action:'claim'})).body.task,null);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM tanaghom.agent_jobs WHERE job_type IN ('content.postiz.draft','lead.ghl.contact_upsert','ghl.action.execute')")).rows[0].n,0);
  await docker(...args,'export:workflow','--all','--output=/home/node/.n8n/export.json');
  const exported=JSON.parse(await docker('run','--rm','--network','none','--entrypoint','cat','-v',`${name}-n8n:/home/node/.n8n:ro`,images.n8n,'/home/node/.n8n/export.json'));
  assert.equal(exported.length,1);assert.equal(exported[0].active,false);assert(!exported[0].nodes.some(n=>n.type==='n8n-nodes-base.scheduleTrigger'));
  await docker(...args,'audit');
  pass('zero external-action jobs; both stops restored; exported n8n still inactive and no schedule');
  evidence={...evidence,result:'PASS',manifest,checks,actual_n8n_manual_executions:workflowExecutions,attempts_completed:360,
    simulated_model_http_calls:324,deterministic_reports:36,paired_conditions_verified:144,
    measurements_kind:'stub_transport_only_not_model_quality_or_production_latency',
    model_tokens:null,model_memory:null,model_cost:null,unmeasured_reason:'No real model executed; response usage fields are authored simulator fixtures.',
    attempts:tasks.map(t=>({case_id:t.case_id,profile:t.profile_code,language:t.language,arm:t.arm,repetition:t.repetition,
      status:t.status,response_hash:t.response_hash,result_hash:fingerprint(t.result),gateway_roundtrip_ms:Number(t.gateway_roundtrip_ms),quality_scores:null})),
    prepared_record_hash:fingerprint(preparedRecords),simulated_response_records_hash:fingerprint(modelRecords)};
}catch(e){console.error('Isolated comparison failed:',e.message);evidence={...evidence,checks,diagnostics:failures,attempts_queued:attemptIds.length,simulated_model_http_calls:modelRecords.length,failure:'isolated_comparison_failed'};process.exitCode=1;
}finally{
  autoQueue=false;
  if(pool)await pool.query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=true,model_execution_enabled=false; UPDATE tanaghom.agent_runtime_controls SET emergency_stop=true').catch(()=>{});
  await mkdir(join(root,'tmp'),{recursive:true});
  const artifact=JSON.stringify(evidence,null,2)+'\n';
  await writeFile(join(root,`tmp/${name}-evidence.json`),artifact,{flag:'wx'});
  await writeFile(join(root,'tmp/agency-quality-runner-evidence.json'),artifact);
  if(dashboard){dashboard.kill();await Promise.race([once(dashboard,'exit').catch(()=>{}),delay(4000)]);}
  for(const s of [gateway,auth,model])if(s){s.closeAllConnections();s.close();}
  await restricted?.end();await pool?.end();
  await docker('rm','-f',`${name}-worker`).catch(()=>{});await docker('rm','-f',name).catch(()=>{});
  await docker('volume','rm',`${name}-n8n`).catch(()=>{});await docker('volume','rm',`${name}-pgdata`).catch(()=>{});
  const target=resolve(temporary);assert(target.startsWith(resolve(tmpdir())+sep)&&target.split(sep).at(-1).startsWith('tanaghom-quality-'));
  await rm(target,{recursive:true,force:true});
  console.log(`Evidence: tmp/${name}-evidence.json (${evidence.result}); only owned disposable resources cleaned up.`);
}
