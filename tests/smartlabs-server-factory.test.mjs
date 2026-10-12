import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {runInNewContext} from 'node:vm';
import * as smartlabs from '../packages/agent-runtime/providers/smartlabs.mjs';
import * as workspace from '../packages/agent-runtime/workspace.mjs';
const source=new URL('../apps/dashboard/lib/server/smartlabs-runtime.ts',import.meta.url);
const require=createRequire(import.meta.url);
async function loopback(t,handler){const server=createServer(handler);server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});return `http://127.0.0.1:${server.address().port}`;}
const id='11111111-1111-4111-8111-111111111111';
function audio(){const b=Buffer.alloc(4844);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4800,40);b.writeInt16LE(42,44);return b;}
function env(url){return {SMARTLABS_GEMMA_BASE_URL:url,SMARTLABS_API_BASE_URL:url,SMARTLABS_ASR_URL:url+'/transcriptions',SMARTLABS_GEMMA_API_KEY:'dummy-test-secret',SMARTLABS_API_KEY:'dummy-test-secret',SMARTLABS_ASR_ENABLED:'true',SMARTLABS_TTS_ENABLED:'true',SMARTLABS_GEMMA_ENABLED:'true'};}
test('actual compiled ASR bridge resolves tenant-owned version through private storage and audits checksum only',async t=>{
 let calls=0,audits=0;const bytes=audio(),hash=require('node:crypto').createHash('sha256').update(bytes).digest('hex'),key=`t/${id}/voice/${id}/v1.wav`;
 const url=await loopback(t,(req,res)=>{calls++;req.resume();res.setHeader('content-type','application/json');res.end(JSON.stringify({text:'نص خاص',language:'ar',duration:.1,processing_time_ms:1}));});
 let foreign=false;const db={query:async(sql,args)=>{if(sql.includes('creative_controls'))return {rows:[{enabled:true,emergency_stop:false}]};if(sql.includes('FROM tanaghom.creative_asset_versions')){assert.equal(args[1],id);return {rows:foreign?[]:[{id,asset_id:id,job_id:id,object_key:key,mime:'audio/wav',bytes:bytes.length,sha256:hash,organization_id:id,correlation_id:id}]};}assert.ok(sql.includes('agent_actions_log'));audits++;assert.equal(JSON.stringify(args).includes('نص خاص'),false);assert.equal(JSON.stringify(args).includes('dummy-test-secret'),false);return {rows:[]};}};
 const storage={get:async(k,bound)=>{assert.equal(k,key);assert.equal(bound,25*1024*1024);return {bytes,mime:'audio/wav'};}};
 const runtime=await compileFactory({db,storage,env:env(url)}).smartLabsRuntime({});assert.equal(typeof runtime.asr?.transcribe,'function');
 const out=await runtime.asr.transcribe({sourceVersionId:id});assert.equal(out.source.versionId,id);assert.equal(out.text,'نص خاص');assert.equal(audits,1);
 foreign=true;await assert.rejects(runtime.asr.transcribe({sourceVersionId:id}),e=>e.code==='controlled_audio_not_found');assert.equal(calls,1);
});


for(const status of ['draft','rejected','archived','approved'])test(`ASR requires current SQL approved source: ${status}`,async t=>{
 let reads=0,calls=0;const bytes=audio(),sha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const url=await loopback(t,(req,res)=>{calls++;req.resume();res.setHeader('content-type','application/json');res.end(JSON.stringify({text:'مرحبا',language:'ar',duration:.1,processing_time_ms:1}));});
 const db={query:async sql=>sql.includes('creative_controls')?{rows:[{enabled:true,emergency_stop:false}]}:sql.includes('FROM tanaghom.creative_asset_versions')?{rows:(sql.includes("v.status = 'approved'")?status==='approved':!['rejected','archived'].includes(status))?[{id,asset_id:id,job_id:id,object_key:`t/${id}/voice/${id}/v1.wav`,mime:'audio/wav',bytes:bytes.length,sha256,status}]:[]}:{rows:[]}};
 const runtime=await compileFactory({db,env:env(url),storage:{get:async()=>{reads++;return {bytes,mime:'audio/wav'};}}}).smartLabsRuntime({});
 if(status==='approved')await runtime.asr.transcribe({sourceVersionId:id});else await assert.rejects(runtime.asr.transcribe({sourceVersionId:id}),e=>e.code==='controlled_audio_not_found');
 assert.equal(reads,status==='approved'?1:0);assert.equal(calls,status==='approved'?1:0);
});

test('actual private storage reader refuses oversize file before unbounded allocation',async t=>{
 const ts=process.env.SMARTLABS_TEST_TYPESCRIPT?require(process.env.SMARTLABS_TEST_TYPESCRIPT):require('typescript');const {mkdtemp,rm}=await import('node:fs/promises');const path=require('node:path');
 const directory=await mkdtemp(path.join(process.env.TMPDIR??path.join(process.cwd(),'tmp'),'sl-audio-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const output=ts.transpileModule(readFileSync(new URL('../apps/dashboard/lib/server/creative/storage.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const exports={};runInNewContext(output,{exports,require:name=>name==='server-only'?{}:require(name),Buffer,process:{env:{},cwd:()=>process.cwd()}});const storage=exports.localStorage(directory),key=`t/${id}/voice/${id}/v1.wav`;
 await storage.put(key,audio(),'audio/wav');assert.deepEqual((await storage.get(key,5000)).bytes,audio());await assert.rejects(storage.get(key,100),e=>e.message==='object_size_exceeded');
});


test('TTS actual factory writes private draft version on existing voice job, durable guard prevents second spend',async t=>{
 let calls=0,reserved=false,put=0,committed=false;const bytes=audio();
 const url=await loopback(t,(req,res)=>{calls++;req.resume();res.setHeader('content-type','audio/wav');res.end(bytes);});
 const db={query:async(sql,args)=>{
  if(sql.includes('creative_controls'))return {rows:[{enabled:true,emergency_stop:false}]};
  if(sql.includes('FROM tanaghom.creative_jobs')){assert.equal(args[1],id);return {rows:[{id,requested_by:id,organization_id:id,capability:'voice',status:'running',claimed_by:'existing-owned-worker',lease_expires_at:new Date(Date.now()+300000),cancel_requested:false,correlation_id:id}]};}
  if(sql.includes('INSERT INTO tanaghom.api_idempotency_keys')){if(reserved)return {rows:[]};reserved=true;return {rows:[{id}]};}
  if(sql.includes('FROM tanaghom.creative_asset_versions'))return {rows:committed?[{id,asset_id:id,job_id:id,status:'draft'}]:[]};
  if(sql.includes('UPDATE tanaghom.api_idempotency_keys'))return {rows:[]};throw new Error('unexpected SQL '+sql);
 }};
 const workerPool={connect:async()=>({query:async(sql,args)=>{if(sql==='COMMIT')committed=true;if(sql.includes('create_creative_asset_version')){assert.equal(args[0],id);assert.equal(args[1],'existing-owned-worker');assert.equal(args[3],'audio/wav');assert.equal(args[4],100);assert.equal(JSON.stringify(args).includes('مرحبا'),false);return {rows:[{id}]};}return {rows:[{}]};},release(){}})};
 const storage={put:async(key,b,mime)=>{put++;assert.ok(key.startsWith(`t/${id}/voice/`));assert.equal(mime,'audio/wav');assert.deepEqual(b,bytes);return {sha256:require('node:crypto').createHash('sha256').update(b).digest('hex')};},get:async()=>({bytes,mime:'audio/wav'}),remove:async()=>{throw new Error('must not delete committed bytes');}};
 const runtime=await compileFactory({db,storage,env:env(url)}).smartLabsRuntime({}, {workerPool});assert.equal(typeof runtime.tts?.synthesizeToAsset,'function');
 const out=await runtime.tts.synthesizeToAsset({jobId:id,text:'مرحبا'});assert.equal(out.assetVersionId,id);assert.equal(out.jobId,id);assert.equal(out.status,'draft');assert.equal(calls,1);assert.equal(put,1);assert.ok(committed);
 await assert.rejects(runtime.tts.synthesizeToAsset({jobId:id,text:'مرحبا'}),e=>e.code==='attempt_already_reserved');assert.equal(calls,1);
});


test('controlled Creative audio vocabulary/key/storage mirrors admit Ogg FLAC AAC without public URLs',async()=>{
 const {MIME_TYPES}=await import('../packages/creative-runtime/capabilities.mjs');const {buildObjectKey,parseObjectKey}=await import('../packages/creative-runtime/storage/keys.mjs');
 for(const mime of ['audio/ogg','audio/flac','audio/aac']){assert.ok(MIME_TYPES.includes(mime));const key=buildObjectKey({organizationId:id,assetId:id,capability:'voice',version:1,mime});assert.equal(parseObjectKey(key).mime,mime);}
});


test('Creative schema MIME mirrors include controlled compressed audio',()=>{
 for(const file of ['asset-version-metadata.v1.schema.json','adapter-envelope.v1.schema.json']){const schema=JSON.parse(readFileSync(new URL('../packages/contracts/schemas/creative/'+file,import.meta.url)));for(const mime of ['audio/ogg','audio/flac','audio/aac'])assert.ok(schema.properties.mime.enum.includes(mime));}
});


test('guarded server smoke preserves draft, pauses for human approval before A1 and cannot re-spend G1 T1',async t=>{
 const events=[];let group=false,tts=false,asset=false;const bytes=audio(),sha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const url=await loopback(t,(req,res)=>{req.resume();res.setHeader('content-type',req.url==='/text-to-speech'?'audio/wav':'application/json');
  if(req.url==='/chat/completions'){events.push('G1');res.end(JSON.stringify({model:'gemma4-26b-a4b-canary',choices:[{message:{role:'assistant',content:'مرحبا'},finish_reason:'stop'}]}));}
  else if(req.url==='/text-to-speech'){events.push('T1');res.end(bytes);}else if(req.url==='/transcriptions'){events.push('A1');res.end(JSON.stringify({text:'مرحبا',language:'ar',duration:.1,processing_time_ms:1}));}else {events.push('unexpected request');res.end('{}');}
 });
 const job={id,requested_by:id,organization_id:id,capability:'voice',status:'running',claimed_by:'owned-worker',lease_expires_at:new Date(Date.now()+300000),cancel_requested:false,correlation_id:id};
 async function query(sql,args){
  if(sql.includes('creative_controls'))return {rows:[{enabled:true,emergency_stop:false}]};
  if(sql.includes("v.status = 'approved'"))return {rows:[]};
  if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{locked:true}]};
  if(sql.includes('FROM tanaghom.api_idempotency_keys'))return {rows:group?[{id}]:[]};
  if(sql.includes('INSERT INTO tanaghom.api_idempotency_keys')){if(sql.includes('smartlabs.smoke.issue242')){group=true;events.push('group reserved');}else {if(tts)return {rows:[]};tts=true;}return {rows:[{id}]};}
  if(sql==='COMMIT'){events.push('guard committed');return {rows:[]};}
  if(sql.includes('FROM tanaghom.creative_jobs'))return {rows:[job]};
  if(sql.includes('FROM tanaghom.creative_asset_versions'))return {rows:asset?[{id,asset_id:id,job_id:id,status:'draft',mime:'audio/wav',sha256,bytes:bytes.length,object_key:`t/${id}/voice/${id}/v1.wav`,organization_id:id}]:[]};
  return {rows:[]};
 }
 const db={query,connect:async()=>({query,release(){}})};
 const workerPool={connect:async()=>({query:async sql=>{if(sql.includes('create_creative_asset_version'))return {rows:[{id}]};if(sql==='COMMIT')asset=true;return {rows:[]};},release(){}})};
 const storage={put:async()=>({sha256}),get:async()=>({bytes,mime:'audio/wav'}),remove:async()=>{}};
 const runtime=await compileFactory({env:env(url),db,storage}).smartLabsRuntime({}, {workerPool,tokenCounter:()=>5,thinkingDisabled:true});assert.equal(typeof runtime.smoke,'function');
 const receipt=await runtime.smoke({jobId:id,confirmation:'ISSUE242_ONE_ATTEMPT'});assert.equal(receipt.status,'REVIEW_REQUIRED');assert.equal(receipt.T1.status,'draft');assert.equal(receipt.A1.status,'NOT_RUN_REQUIRES_APPROVED_SOURCE');assert.deepEqual(events.filter(e=>['G1','T1','A1'].includes(e)),['G1','T1']);assert.ok(events.indexOf('guard committed')<events.indexOf('G1'));assert.equal(JSON.stringify(receipt).includes('dummy-test-secret'),false);assert.equal(JSON.stringify(receipt).includes('مرحبا'),false);
 await assert.rejects(runtime.smoke({jobId:id,confirmation:'ISSUE242_ONE_ATTEMPT'}),e=>e.code==='smoke_already_reserved');assert.equal(events.filter(e=>['G1','T1','A1'].includes(e)).length,2);
});


test('smoke CLI requires explicit confirmation, installed server configuration and trusted context before invoking anything',()=>{
 const cli=new URL('../scripts/smartlabs-smoke.mjs',import.meta.url);assert.equal(existsSync(cli),true,'actual guarded smoke CLI exists');const {spawnSync}=require('node:child_process');
 const r=spawnSync(process.execPath,[cli.pathname.replace(/^\/([A-Za-z]:)/,'$1')],{encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},timeout:10000});assert.equal(r.status,2);assert.match(r.stderr,/smoke_confirmation_required/);assert.equal(r.stderr.includes('API_KEY'),false);
});


test('owned active voice prerequisites reject invalid lease and foreign smoke job before spending',async t=>{
 let calls=0;const url=await loopback(t,(req,res)=>{calls++;req.resume();res.setHeader('content-type',req.url==='/text-to-speech'?'audio/wav':'application/json');res.end(req.url==='/text-to-speech'?audio():JSON.stringify({model:'gemma4-26b-a4b-canary',choices:[{message:{role:'assistant',content:'مرحبا'},finish_reason:'stop'}]}));});
 let foreign=false;const query=async sql=>sql.includes('creative_controls')?{rows:[{enabled:true,emergency_stop:false}]}:sql.includes('FROM tanaghom.creative_jobs')?{rows:foreign?[]:[{id,requested_by:id,organization_id:id,capability:'voice',status:'running',claimed_by:'owned-worker',lease_expires_at:'invalid',cancel_requested:false,correlation_id:id}]}:sql.includes('pg_try_advisory')?{rows:[{locked:true}]}:sql.includes('FROM tanaghom.api_idempotency')?{rows:[]}:{rows:[{id}]};
 const db={query,connect:async()=>({query,release(){}})};const workerPool={connect:async()=>{throw Object.assign(new Error('fixture unexpected connect'),{code:'fixture_unexpected_connect'});}};
 const runtime=await compileFactory({db,env:env(url)}).smartLabsRuntime({}, {workerPool,tokenCounter:()=>5,thinkingDisabled:true});
 await assert.rejects(runtime.tts.synthesizeToAsset({jobId:id,text:'مرحبا'}),e=>e.code==='owned_active_voice_job_required');assert.equal(calls,0);
 foreign=true;await assert.rejects(runtime.smoke({jobId:id,confirmation:'ISSUE242_ONE_ATTEMPT'}),e=>e.code==='owned_active_voice_job_required');assert.equal(calls,0);
});

for(const control of [{enabled:false,emergency_stop:false},{enabled:true,emergency_stop:true},null,'error'])for(const operation of ['tts','asr'])test(`${operation} current Creative execution gate fails closed ${JSON.stringify(control)}`,async t=>{
 let calls=0,reads=0,reservations=0;const url=await loopback(t,(req,res)=>{calls++;req.resume();res.end('{}');});
 const db={query:async sql=>{if(sql.includes('creative_controls')){if(control==='error')throw new Error('secret database diagnostic');return {rows:control?[control]:[]};}if(sql.includes('api_idempotency_keys'))reservations++;return {rows:[{id,requested_by:id,capability:'voice',status:'running',claimed_by:'worker',lease_expires_at:new Date(Date.now()+300000)}]};}};
 const runtime=await compileFactory({db,env:env(url),storage:{get:async()=>{reads++;return null;}}}).smartLabsRuntime({}, {workerPool:{connect:async()=>{throw new Error('unexpected worker I/O');}}});
 await assert.rejects(operation==='asr'?runtime.asr.transcribe({sourceVersionId:id}):runtime.tts.synthesizeToAsset({jobId:id,text:'مرحبا'}),e=>e.code==='creative_execution_disabled'&&e.message==='creative_execution_disabled');
 assert.equal(calls,0);assert.equal(reads,0);assert.equal(reservations,0);
});

function compileFactory(doubles={}){
 assert.equal(existsSync(source),true,'actual server factory exists');
 const ts=process.env.SMARTLABS_TEST_TYPESCRIPT?require(process.env.SMARTLABS_TEST_TYPESCRIPT):require('typescript');
 const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const exports={};const mapped={'server-only':{},'node:crypto':require('node:crypto'),'@/lib/server/authorization':{authorize:async()=>{doubles.calls?.push('authorize');return {id:'11111111-1111-4111-8111-111111111111',organizationId:'11111111-1111-4111-8111-111111111111',role:'owner'};}},'@/lib/server/auth':{enforceSameOriginForCookieMutation:()=>doubles.calls?.push('same-origin')},'@/lib/server/database':{database:()=>doubles.db},'@/lib/server/creative/feature-control':{requireCreativeStudio:()=>{}},'@/lib/server/creative/storage':{localStorage:()=>doubles.storage},'@/lib/server/creative/object-keys':{buildUploadObjectKey:a=>`t/${a.organizationId}/voice/${a.nonce}/v1.wav`}};
 runInNewContext(compiled.outputText,{exports,require:name=>{assert.ok(name in mapped,'unexpected import '+name);return mapped[name];},Buffer,Date,process:{env:doubles.env??{},cwd:()=>process.cwd(),getBuiltinModule:name=>name==='module'?{createRequire:()=>name=>name==='@tanaghom/agent-runtime/smartlabs'?{...smartlabs,createSmartLabsAdapters:(c,d)=>smartlabs.createSmartLabsAdapters(c,{...d,ownedLoopbackTest:c.gemmaBaseUrl.startsWith('http://127.0.0.1:')})}:name==='@tanaghom/agent-runtime/workspace'?workspace:null}:require(name)}});
 return exports;
}
test('compiled server factory authenticates request; default OFF health exposes presence only without network',async()=>{
 const calls=[];const m=compileFactory({calls});assert.equal(typeof m.smartLabsRuntime,'function');
 const runtime=await m.smartLabsRuntime({});assert.deepEqual(calls,['authorize']);
 const health=await runtime.health();assert.equal(health.tts.enabled,false);assert.equal(health.asr.configured,false);assert.equal(health.gemma.enabled,false);
 await assert.rejects(runtime.gemma.complete({messages:[{role:'user',content:'مرحبا'}]}),e=>e.code==='adapter_disabled');
 assert.equal(JSON.stringify(health).includes('API_KEY'),false);
});
