// #242 native local proof: compiled trusted factory seam + actual Next API/auth,
// actual PostgreSQL restricted logins/private filesystem, provider-shaped stubs.
// Never a live provider certificate; no public endpoint is added to the app.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import pg from 'pg';
import * as smartlabs from '../packages/agent-runtime/providers/smartlabs.mjs';
import * as workspace from '../packages/agent-runtime/workspace.mjs';
const require=createRequire(import.meta.url),ts=require('typescript'),{NextRequest}=require('next/server');
const url=new URL(process.env.DATABASE_TEST_URL??'');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/smartlabs242');
const owner=process.env.SMARTLABS_LOCAL_FIXTURE_OWNER;
assert.match(owner??'',/^issue242-[a-f0-9]{32}$/,'explicit owned fixture label required');
const admin=new pg.Pool({connectionString:url.href,max:2});
const roleUrl=role=>{const u=new URL(url);u.username=role;u.password='fixture242-only';return u.href;};
const api=new pg.Pool({connectionString:roleUrl('tanaghom_api'),max:3});
const worker=new pg.Pool({connectionString:roleUrl('tanaghom_creative_worker'),max:2});
const org=randomUUID(),actor=randomUUID(),subject=randomUUID(),otherOrg=randomUUID(),otherActor=randomUUID(),otherSubject=randomUUID();
const servers=[];let next;const directory=await mkdtemp(join(process.env.TMPDIR,'smartlabs-242-private-'));
async function listen(handler){const s=createServer(handler);servers.push(s);s.listen(0,'127.0.0.1');await once(s,'listening');return 'http://127.0.0.1:'+s.address().port;}
function compile(path,mapped,env){const result=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);const exports={};runInNewContext(result.outputText,{exports,require:name=>{if(name==='server-only')return {};if(name in mapped)return mapped[name];assert.ok(name.startsWith('node:')||name==='jose','unmapped trusted import '+name);return require(name);},Buffer,Date,URL,process:{env,cwd:()=>process.cwd(),getBuiltinModule:name=>name==='module'?{createRequire:()=>id=>id==='@tanaghom/agent-runtime/smartlabs'?{...smartlabs,createSmartLabsAdapters:(c,d)=>smartlabs.createSmartLabsAdapters(c,{...d,ownedLoopbackTest:true})}:id==='@tanaghom/agent-runtime/workspace'?workspace:null}:require(name)}});return exports;}
function wav(){const data=4800,b=Buffer.alloc(44+data);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data,40);for(let i=0;i<data/2;i++)b.writeInt16LE(Math.round(500*Math.sin(i*.2)),44+i*2);return b;}
const audio=wav(),hash=createHash('sha256').update(audio).digest('hex'),counts={gemma:0,tts:0,asr:0,models:0};
const text='مرحبا بكم في تناغم.',prompt='أجب بتحية عربية قصيرة.';
try{
 assert.equal((await admin.query("SELECT shobj_description(oid,'pg_database') AS owner FROM pg_database WHERE datname=current_database()")).rows[0].owner,owner,'owned fixture DB marker must match');
 await admin.query("ALTER ROLE tanaghom_api LOGIN PASSWORD 'fixture242-only'; ALTER ROLE tanaghom_creative_worker LOGIN PASSWORD 'fixture242-only'");
 for(const [pool,role] of [[api,'tanaghom_api'],[worker,'tanaghom_creative_worker']]){
  const actual=(await pool.query('SELECT current_user AS role,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.deepEqual(actual,{role,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolbypassrls:false});
  for(const table of ['creative_jobs','creative_assets','creative_asset_versions'])for(const sql of [`INSERT INTO tanaghom.${table} DEFAULT VALUES`,`UPDATE tanaghom.${table} SET id=id`,`DELETE FROM tanaghom.${table}`])await assert.rejects(pool.query(sql),e=>e.code==='42501');
 }
 await assert.rejects(api.query('SET ROLE tanaghom_creative_worker'),e=>e.code==='42501');await assert.rejects(worker.query('SET ROLE tanaghom_api'),e=>e.code==='42501');
 console.log('PASS actual API/worker login restrictions, direct creative CRUD and role escalation denied');
 for(const [o,a,s,name] of [[org,actor,subject,'owner'],[otherOrg,otherActor,otherSubject,'other']]){
  await admin.query('INSERT INTO tanaghom.organizations(id,slug,name,is_active) VALUES($1,$2,$3,true)',[o,'fixture242-'+o,name]);
  await admin.query("INSERT INTO tanaghom.app_users(id,organization_id,email,display_name,kind,role,auth_subject,accepted_at) VALUES($1,$2,$3,$4,'human','owner',$5,now())",[a,o,name+'-'+o+'@example.test',name,s]);
 }
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'fixture242',alg:'RS256',use:'sig'};
 const authOrigin=await listen((req,res)=>{assert.equal(req.url,'/auth/v1/.well-known/jwks.json');res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[jwk]}));});
 const token=s=>new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'RS256',kid:'fixture242'}).setSubject(s).setIssuer(authOrigin+'/auth/v1').setAudience('authenticated').setIssuedAt().setExpirationTime('10m').sign(privateKey);
 const ownerHeaders={authorization:'Bearer '+await token(subject)},foreignHeaders={authorization:'Bearer '+await token(otherSubject)};
 const providerOrigin=await listen(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
  if(req.url==='/chat/completions'){
   counts.gemma++;assert.equal(req.headers.authorization,'Bearer fake-242-gemma-file');const input=JSON.parse(body);assert.equal(input.model,'gemma4-26b-a4b-canary');assert.equal(input.stream,false);assert.deepEqual(Object.keys(input).sort(),['max_tokens','messages','model','stream','temperature']);assert.equal(input.messages[0].content,prompt);
   res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'fixture242-gemma',model:input.model,choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:7,total_tokens:12}}));
  }else if(req.url==='/text-to-speech'){
   counts.tts++;assert.equal(req.headers['x-api-key'],'fake-242-api-file');assert.deepEqual(JSON.parse(body),{text,tts_backend:'omnivoice',voice_id:'smarttts2-xms-default',dialect_id:'ar-SA'});res.setHeader('content-type','audio/wav');res.end(audio);
  }else if(req.url==='/transcriptions'){
   counts.asr++;assert.equal(req.headers['x-api-key'],'fake-242-api-file');
   const request=new Request(providerOrigin+req.url,{method:'POST',headers:{'content-type':req.headers['content-type']},body});const form=await request.formData();assert.deepEqual([...form.keys()].sort(),['file','language']);assert.equal(form.get('language'),'ar');assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()),audio);assert.equal(form.get('file').type,'audio/wav');
   res.setHeader('content-type','application/json');res.end(JSON.stringify({text,language:'ar',duration:.1,processing_time_ms:1,request_id:'fixture242-asr'}));
  }else{counts.models++;assert.equal(req.url,'/models');res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'gemma4-26b-a4b-canary'}]}));}
 });
 const {writeFile}=await import('node:fs/promises');const gf=join(directory,'fake-gemma-key'),af=join(directory,'fake-api-key');await writeFile(gf,'fake-242-gemma-file\n');await writeFile(af,'fake-242-api-file\r\n');
 const appEnv={CREATIVE_STUDIO_ENABLED:'true',CREATIVE_UPLOAD_DIR:directory,SUPABASE_URL:authOrigin,SMARTLABS_GEMMA_API_KEY_FILE:gf,SMARTLABS_API_KEY_FILE:af,SMARTLABS_GEMMA_BASE_URL:providerOrigin,SMARTLABS_API_BASE_URL:providerOrigin,SMARTLABS_ASR_URL:providerOrigin+'/transcriptions',SMARTLABS_GEMMA_ENABLED:'true',SMARTLABS_TTS_ENABLED:'true',SMARTLABS_ASR_ENABLED:'true'};
 const auth=compile('apps/dashboard/lib/server/auth.ts',{},appEnv);
 const authorization=compile('apps/dashboard/lib/server/authorization.ts',{'@/lib/server/auth':auth,'@/lib/server/database':{database:()=>api}},appEnv);
 const storage=compile('apps/dashboard/lib/server/creative/storage.ts',{},appEnv);let privateReads=0;
 const originalStorage=storage.localStorage;storage.localStorage=(...args)=>{const value=originalStorage(...args);return {...value,get:async(...input)=>{privateReads++;return value.get(...input);}};};
 const keys=compile('apps/dashboard/lib/server/creative/object-keys.ts',{},appEnv);
 const control=compile('apps/dashboard/lib/server/creative/feature-control.ts',{},appEnv);
 const factory=compile('apps/dashboard/lib/server/smartlabs-runtime.ts',{'@/lib/server/auth':auth,'@/lib/server/authorization':authorization,'@/lib/server/database':{database:()=>api},'@/lib/server/creative/storage':storage,'@/lib/server/creative/object-keys':keys,'@/lib/server/creative/feature-control':control},appEnv);
 // Exact counter is attested only for this immutable synthetic fixture/template,
 // NOT the operator's unknown production tokenizer/model binding.
 const fixtureCounter=({messages})=>{assert.equal(messages.length,1);assert.equal(messages[0].content,prompt);return 5;};
 const capabilities={workerPool:worker,tokenCounter:fixtureCounter,thinkingDisabled:true};
 const offEnv={...appEnv,SMARTLABS_GEMMA_ENABLED:'false',SMARTLABS_TTS_ENABLED:'false',SMARTLABS_ASR_ENABLED:'false'};
 const offFactory=compile('apps/dashboard/lib/server/smartlabs-runtime.ts',{'@/lib/server/auth':auth,'@/lib/server/authorization':authorization,'@/lib/server/database':{database:()=>api},'@/lib/server/creative/storage':storage,'@/lib/server/creative/object-keys':keys,'@/lib/server/creative/feature-control':control},offEnv);
 const offRuntime=await offFactory.smartLabsRuntime(new NextRequest('http://127.0.0.1/fixture',{headers:ownerHeaders}),capabilities);
 const offHealth=await offRuntime.health();assert.equal(offHealth.gemma.enabled,false);assert.equal(offHealth.tts.enabled,false);assert.equal(offHealth.asr.enabled,false);assert.equal(offHealth.gemma.configured,true);assert.equal(offHealth.tts.configured,true);assert.equal(offHealth.asr.configured,true);
 assert.equal(JSON.stringify(offHealth).includes('fake-242'),false);assert.deepEqual(counts,{gemma:0,tts:0,asr:0,models:0});
 console.log('PASS actual auth + file-only configured flags-OFF factory health has zero provider requests and no keys');
 const mountedOrigin=await listen(async(req,res)=>{
  try{
   const request=new NextRequest(mountedOrigin+req.url,{headers:req.headers,method:req.method});const runtime=await factory.smartLabsRuntime(request,capabilities);let out;
   if(req.url==='/health')out=await runtime.health();
   else{const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));if(req.url==='/gemma')out=await runtime.gemma.complete(input);else if(req.url==='/tts')out=await runtime.tts.synthesizeToAsset(input);else if(req.url==='/asr')out=await runtime.asr.transcribe(input);else throw new Error('fixture endpoint');}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(out));
  }catch(e){res.statusCode=e instanceof auth.AuthenticationError?401:e instanceof authorization.AuthorizationError?403:e.status??500;res.setHeader('content-type','application/json');res.end(JSON.stringify({code:e.code??'fixture_auth_denied'}));}
 });
 async function call(path,headers,input){const r=await fetch(mountedOrigin+path,{method:input?'POST':'GET',headers:{...headers,'content-type':'application/json'},body:input?JSON.stringify(input):undefined});return {status:r.status,body:await r.json()};}
 // Actual production Next server with SmartLabs flags OFF and dummy markers.
 const portServer=createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(r=>portServer.close(r));const nextOrigin='http://127.0.0.1:'+port;
 const nextEnv={...process.env,...appEnv,DATABASE_URL:roleUrl('tanaghom_api'),APP_ENV:'integration',NEXT_TELEMETRY_DISABLED:'1',SMARTLABS_GEMMA_ENABLED:'false',SMARTLABS_TTS_ENABLED:'false',SMARTLABS_ASR_ENABLED:'false'};
 for(const key of ['NODE_OPTIONS','SMARTLABS_GEMMA_API_KEY','SMARTLABS_API_KEY'])delete nextEnv[key];
 next=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/dashboard','-H','127.0.0.1','-p',String(port)],{env:nextEnv,stdio:['ignore','pipe','pipe']});let nextOutput='';next.stdout.on('data',b=>nextOutput+=b);next.stderr.on('data',b=>nextOutput+=b);
 let ready=false;for(let i=0;i<120;i++){assert.equal(next.exitCode,null,'Next must stay up');try{if((await fetch(nextOrigin+'/api/health')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'actual built Next ready');
 const markers=['fake-242-gemma-file','fake-242-api-file','FAKE242_GEMMA_DIRECT_37eae4','FAKE242_API_DIRECT_03fa8a','FAKE242_GEMMA_FILE_e4da73','FAKE242_API_FILE_bae107',gf,af];
 for(const path of ['/login','/workspace','/creative','/api/health']){
  const r=await fetch(nextOrigin+path,{headers:{...ownerHeaders,cookie:'tanaghom_access_token='+ownerHeaders.authorization.slice(7)}});assert.equal(r.status,200,'render '+path);assert.equal(new URL(r.url).pathname,path);const body=await r.text();assert.ok(!markers.some(s=>body.includes(s)));assert.ok(!body.includes('SMARTLABS_'));console.log('PASS built Next rendered secret isolation '+path+' bytes='+Buffer.byteLength(body));
 }
 assert.deepEqual(counts,{gemma:0,tts:0,asr:0,models:0});
 const anonymous=await call('/gemma',{}, {messages:[{role:'user',content:prompt}]});assert.equal(anonymous.status,401);assert.deepEqual(counts,{gemma:0,tts:0,asr:0,models:0});
 await api.query('SELECT tanaghom.set_creative_control($1,true,false,$2)',[actor,'Issue242 owned stub fixture only']);
 const correlation=randomUUID();const queued=await fetch(nextOrigin+'/api/creative/jobs',{method:'POST',headers:{...ownerHeaders,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({capability:'voice',lane:'gpu_audio',params:{fixture:true},idempotency_key:randomUUID(),correlation_id:correlation,priority:100})});assert.equal(queued.status,200);const jobId=(await queued.json()).job_id;
 const claimed=(await worker.query("SELECT * FROM tanaghom.claim_creative_job('gpu_audio','issue242-combined-worker',600)")).rows[0];assert.equal(claimed.job_id,jobId);await worker.query("SELECT tanaghom.mark_creative_job_running($1,'issue242-combined-worker')",[jobId]);
 for(const [enabled,stop] of [[false,false],[true,true]]){
  await api.query('SELECT tanaghom.set_creative_control($1,$2,$3,$4)',[actor,enabled,stop,'Owned pre-dispatch stop probe']);
  const blocked=await call('/tts',ownerHeaders,{jobId,text});assert.equal(blocked.status,503);assert.equal(blocked.body.code,'creative_execution_disabled');
  assert.equal(privateReads,0);assert.deepEqual(counts,{gemma:0,tts:0,asr:0,models:0});
  assert.equal((await api.query("SELECT count(*)::int AS n FROM tanaghom.api_idempotency_keys WHERE operation_type='smartlabs.tts' AND idempotency_key=$1",[jobId])).rows[0].n,0);
 }
 await api.query('SELECT tanaghom.set_creative_control($1,true,false,$2)',[actor,'Owned positive control']);
 console.log('PASS current DB disabled and emergency-stop gates on previously claimed/running TTS job: zero private reads, provider creates and durable reservations');
 const foreignTts=await call('/tts',foreignHeaders,{jobId,text});assert.equal(foreignTts.status,409);assert.deepEqual(counts,{gemma:0,tts:0,asr:0,models:0});
 const gemma=await call('/gemma',ownerHeaders,{messages:[{role:'user',content:prompt}],temperature:0,max_tokens:64});assert.equal(gemma.status,200);assert.equal(gemma.body.text,text);
 const tts=await call('/tts',ownerHeaders,{jobId,text:gemma.body.text});assert.equal(tts.status,200);assert.equal(tts.body.sha256,hash);assert.equal(tts.body.status,'draft');const versionId=tts.body.assetVersionId;
 const version=(await api.query('SELECT v.*,a.organization_id FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id=v.asset_id WHERE v.id=$1',[versionId])).rows[0];assert.equal(version.organization_id,org);assert.equal(version.job_id,jobId);assert.equal(version.provenance.adapter,'smartlabs.tts');assert.equal(version.provenance.input_hash,createHash('sha256').update(text).digest('hex'));assert.equal(version.sha256,hash);assert.deepEqual(await readFile(join(directory,...version.object_key.split('/'))),audio);
 const beforeDraftReads=privateReads;const draftDenied=await call('/asr',ownerHeaders,{sourceVersionId:versionId});assert.equal(draftDenied.status,404);assert.equal(privateReads,beforeDraftReads);assert.equal(counts.asr,0);
 const approved=await fetch(nextOrigin+`/api/creative/assets/versions/${versionId}/decision`,{method:'POST',headers:{...ownerHeaders,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({decision:'approved'})});assert.equal(approved.status,200);assert.equal((await approved.json()).status,'approved');
 for(const [enabled,stop] of [[false,false],[true,true]]){
  await api.query('SELECT tanaghom.set_creative_control($1,$2,$3,$4)',[actor,enabled,stop,'Owned historical approved ASR stop probe']);
  const blocked=await call('/asr',ownerHeaders,{sourceVersionId:versionId});assert.equal(blocked.status,503);assert.equal(blocked.body.code,'creative_execution_disabled');assert.equal(privateReads,beforeDraftReads);assert.equal(counts.asr,0);
 }
 await api.query('SELECT tanaghom.set_creative_control($1,true,false,$2)',[actor,'Owned positive control']);
 console.log('PASS actual SQL draft ASR refusal and approved historical source disabled/emergency-stop refusal: zero additional private reads/uploads');
 const foreignAsr=await call('/asr',foreignHeaders,{sourceVersionId:versionId});assert.equal(foreignAsr.status,404);assert.equal(counts.asr,0);
 const asr=await call('/asr',ownerHeaders,{sourceVersionId:versionId});assert.equal(asr.status,200);assert.equal(asr.body.text,text);assert.equal(asr.body.source.versionId,versionId);assert.equal(asr.body.source.jobId,jobId);assert.equal(asr.body.source.sha256,hash);
 const audit=(await api.query("SELECT correlation_id,payload FROM tanaghom.agent_actions_log WHERE action_type='smartlabs.asr.transcribed' AND entity_id=$1",[versionId])).rows;assert.equal(audit.length,1);assert.equal(audit[0].correlation_id,correlation);assert.equal(audit[0].payload.transcript_sha256,createHash('sha256').update(text).digest('hex'));assert.equal(JSON.stringify(audit).includes(text),false);
 const state=(await api.query('SELECT status,output_asset_ids FROM tanaghom.creative_jobs WHERE id=$1',[jobId])).rows[0];assert.equal(state.status,'succeeded');assert.ok(state.output_asset_ids.includes(tts.body.assetId));
 const before={...counts};const repeat=await call('/tts',ownerHeaders,{jobId,text});assert.equal(repeat.status,409);assert.deepEqual(counts,before);
 assert.deepEqual(counts,{gemma:1,tts:1,asr:1,models:0});
 assert.ok(!markers.some(s=>JSON.stringify({gemma:gemma.body,tts:tts.body,asr:asr.body,audit}).includes(s)));assert.ok(!markers.some(s=>nextOutput.includes(s)));
 console.log('PASS combined mounted actual JWT auth/API tenant + durable controlled Creative lease/job + Gemma stub Arabic -> OmniVoice stub native WAV -> private filesystem/draft/version -> actual Next approval -> ASR same asset -> checksum/hash-only SQL provenance');
 console.log(JSON.stringify({verdict:'PASS_LOCAL_STUB_ONLY',counts,jobStatus:state.status,versionStatus:'approved',wavBytes:audio.length,sha256:hash,duration:.1,templateTokenCounter:'trusted-synthetic-fixture-only',productionTokenizer:'NOT_INSTALLED',factorySeam:'fresh TS compilation; actual auth/authorization + restricted DB/private storage; local HTTP harness only',nextApplication:'actual production build Next server and existing job/approval/rendered routes',realProviderCalls:0}));
}finally{
 if(next&&next.exitCode===null){next.kill('SIGTERM');await once(next,'exit');}
 for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r));}
 await api.end();await worker.end();await admin.end();await rm(directory,{recursive:true,force:true});
}
