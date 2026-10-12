import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readSmartLabsConfig} from '../packages/agent-runtime/providers/smartlabs.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('server config loads exact fake key bytes from _FILE, allowing one terminal LF or CRLF only',t=>{
 const dir=mkdtempSync(join(process.env.TMPDIR??tmpdir(),'smartlabs-242-key-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'fake-key');
 for(const suffix of ['', '\n', '\r\n']){
  writeFileSync(file,'fake-242-exact-key'+suffix);
  const config=readSmartLabsConfig({SMARTLABS_API_KEY_FILE:file,SMARTLABS_GEMMA_API_KEY_FILE:file});
  assert.equal(config.apiKey,'fake-242-exact-key');assert.equal(config.gemmaKey,'fake-242-exact-key');
 }
});

test('server config refuses malformed, ambiguous, empty, missing and unreadable fake secret sources without disclosure',t=>{
 const dir=mkdtempSync(join(process.env.TMPDIR??tmpdir(),'smartlabs-242-invalid-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'fake-key');
 const reject=env=>assert.throws(()=>readSmartLabsConfig(env),e=>{
  assert.equal(e.code,'credentials_configuration_invalid');assert.equal(e.status,503);
  assert.equal(JSON.stringify(e).includes(dir),false);assert.equal(e.message.includes('fake-secret'),false);return true;
 });
 for(const name of ['SMARTLABS_API_KEY','SMARTLABS_GEMMA_API_KEY']){
  for(const value of [' fake-secret','fake-secret ','fake\tsecret','fake-secret\n','fake-secret\r','fake\0secret','é'])reject({[name]:value});
  writeFileSync(file,'fake-secret');
  for(const direct of ['', 'fake-secret'])reject({[name]:direct,[name+'_FILE']:file});
  for(const invalid of ['', 'fake-secret\n\n','fake-secret \n',' fake-secret\n','fake\0secret', 'x'.repeat(4097)]){writeFileSync(file,invalid);reject({[name+'_FILE']:file});}
  for(const path of [join(dir,'missing'),dir,'relative-secret'])reject({[name+'_FILE']:path});
 }
 assert.equal(readSmartLabsConfig({}).gemmaEnabled,false);
 assert.equal(readSmartLabsConfig({}).ttsEnabled,false);
 assert.equal(readSmartLabsConfig({}).asrEnabled,false);
});

test('explicit CLI accepts _FILE only with trusted context and refuses a credential-bearing receipt',t=>{
 const dir=mkdtempSync(join(process.env.TMPDIR??tmpdir(),'smartlabs-242-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'fake-key'),context=join(dir,'context.mjs');writeFileSync(file,'fake-secret-cli\n');
 const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/smartlabs-smoke.mjs',import.meta.url)),'--confirm=ISSUE242_ONE_ATTEMPT','--trusted-context='+context],{encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,SMARTLABS_GEMMA_ENABLED:'true',SMARTLABS_TTS_ENABLED:'true',SMARTLABS_ASR_ENABLED:'true',SMARTLABS_GEMMA_API_KEY_FILE:file,SMARTLABS_API_KEY_FILE:file},timeout:10000});
 const source=leak=>`export async function createSmokeContext(){return {sourceGatesPassed:true,providerAuthorization:'ISSUE242_G1_T1_A1',jobId:'fixture',runtime:{smoke:async()=>({status:'REVIEW_REQUIRED',T1:{status:'draft',assetVersionId:'fixture'},A1:{status:'NOT_RUN_REQUIRES_APPROVED_SOURCE',sourceVersionId:'fixture'},issue:242,quality_certified:false,production_activated:false,fixture:${JSON.stringify(leak)}})}}}`;
 writeFileSync(context,source('stub-only'));const good=run();assert.equal(good.status,0,good.stderr);
 writeFileSync(context,source('fake-secret-cli'));const bad=run();assert.equal(bad.status,2);assert.equal(bad.stdout,'');assert.equal(bad.stderr.includes('fake-secret-cli'),false);assert.match(bad.stderr,/smoke_receipt_invalid/);
});

test('server config refuses enabled capability without its key before dispatch',()=>{
 for(const flag of ['SMARTLABS_GEMMA_ENABLED','SMARTLABS_TTS_ENABLED','SMARTLABS_ASR_ENABLED'])
  assert.throws(()=>readSmartLabsConfig({[flag]:'true'}),e=>e.code==='credentials_missing'&&e.status===503);
});
