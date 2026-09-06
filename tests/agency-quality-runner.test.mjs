import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {corpus,bundleFor,prepareCase,verifyLock} from '../scripts/agency-quality-preparation.mjs';
import {fingerprint} from '../packages/agent-runtime/agency-pilot.mjs';
import {prepareComparison,finishComparison,buildSchedule,conditionHash,modelName} from '../evaluation/agency-runner-v1/runtime.mjs';
import {stubResponse} from '../evaluation/agency-runner-v1/fixtures.mjs';
import {buildWorkflow} from '../evaluation/agency-runner-v1/workflow.mjs';
import {inspectPrerequisites} from '../evaluation/agency-runner-v1/prerequisites.mjs';
import {verifyRunnerLock,runnerLock} from '../evaluation/agency-runner-v1/manifest.mjs';
import {verifyLoopbackTransport} from '../evaluation/agency-runner-v1/transport.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const hash='sha256:'+'1'.repeat(64);
function fixture(arm='baseline',profile='social_media_strategist'){
 const c=corpus.cases.find(c=>c.profile===profile&&c.language==='en'),b=bundleFor(c);
 b.data.model.model_name=modelName;b.basis_hash=hash;b.task.basis_hash=hash;
 const meta={task_id:b.task.id,run_id:'a6000000-0000-4000-8000-000000000099',case_id:c.id,profile_code:profile,
  language:c.language,arm,repetition:1,case_hash:fingerprint(c),execution_kind:'simulated_model',manifest_hash:hash};
 return {b,meta};
}
test('fixed runner preserves prior source locks and schedules every bilingual case/arm/repetition once',()=>{
 verifyLock();verifyRunnerLock();const changed=runnerLock();changed.files.pop();assert.throws(()=>verifyRunnerLock(changed));
 const s=buildSchedule();assert.equal(s.length,360);
 assert.equal(new Set(s.map(a=>`${a.case_id}/${a.arm}/${a.repetition}`)).size,360);
 assert.equal(s.filter(a=>a.profile_code!=='executive_summary').length,324);
 assert.equal(s.filter(a=>a.arm==='baseline').length,144);assert.throws(()=>buildSchedule(4));
});
test('paired runner changes only system augmentation, labels baseline provenance honestly and validates output',()=>{
 for(const profile of ['social_media_strategist','content_creator','discovery_coach','support_responder']){
  const {b,meta}=fixture('baseline',profile),base=prepareComparison(b,meta,hash),adapted=prepareComparison(b,{...meta,arm:'adapted'},hash);
  assert.notEqual(base.request.messages[0].content,adapted.request.messages[0].content);
  assert.equal(conditionHash(base.request),conditionHash(adapted.request));b.task.prepared=base;
  const result=finishComparison(b,stubResponse(base.request),meta,hash);
  assert.equal(result.generation_procedure_hash,null);assert.equal(result.comparison.arm,'baseline');
  assert.equal(result.quality_certified,false);assert.equal(result.external_action_count,0);assert.equal(result.human_approval_granted,false);
  assert(!Object.hasOwn(result,'procedure_hash'));assert(result.validation_procedure_hash);
 }
});
test('caller cannot relabel an arm, use another case/profile, substitute model or invent a reference baseline',()=>{
 const {b,meta}=fixture();
 for(const change of [{arm:'custom'},{profile_code:'support_responder'},{case_hash:'sha256:'+'0'.repeat(64)},
  {execution_kind:'real_model'},{task_id:'different'},{language:'ar'},{manifest_hash:'changed'},{repetition:4}])assert.throws(()=>prepareComparison(b,{...meta,...change},hash));
 const wrong=structuredClone(b);wrong.data.model.model_name='gemma-live';assert.throws(()=>prepareComparison(wrong,meta,hash));
 const changed=structuredClone(b);changed.data.records.campaign.brief='Different task';assert.throws(()=>prepareComparison(changed,meta,hash),/Frozen campaign/);
 const brand=fixture('baseline','brand_guardian');assert.throws(()=>prepareComparison(brand.b,brand.meta,hash));
 b.task.prepared=prepareComparison(b,meta,hash);assert.throws(()=>finishComparison(b,stubResponse(b.task.prepared.request),{...meta,arm:'adapted'},hash));
});
test('condition comparison normalizes only independent trace IDs, not evidence or business facts',()=>{
 const {b,meta}=fixture();const a=prepareComparison(b,meta,hash).request,z=structuredClone(a);
 const input=JSON.parse(z.messages[1].content);input.job_id='other';input.correlation_id='other';z.messages[1].content=JSON.stringify(input);
 assert.equal(conditionHash(a),conditionHash(z));input.campaign.brief+=' changed';z.messages[1].content=JSON.stringify(input);assert.notEqual(conditionHash(a),conditionHash(z));
});
test('disposable workflow accepts loopback endpoints only, remains inactive, has no schedule and uses linked items',()=>{
 const w=buildWorkflow('http://127.0.0.1:3001/quality/worker','http://127.0.0.1:3002/v1/chat/completions');
 assert.equal(w.active,false);assert(!w.nodes.some(n=>n.type.includes('schedule')));
 assert(w.nodes.find(n=>n.name==='Model Completion').parameters.jsCode.includes('itemMatching(0)'));
 for(const u of ['https://api.thesmartlabs.net','http://38.247.187.232','http://127.0.0.1.evil.test','http://user:pass@127.0.0.1','http://host.docker.internal:3001'])assert.throws(()=>buildWorkflow(u,'http://127.0.0.1:3002'));
});
test('prerequisite checker honestly reports missing names/model evidence and never grants execution authority',()=>{
 const state=inspectPrerequisites();assert.equal(state.complete,false);assert.equal(state.live_execution_authorized,false);
 assert(state.missing.includes('domain_approver'));assert(state.missing.includes('model.weights_sha256'));
 const template=JSON.parse(readFileSync(new URL('../evaluation/agency-runner-v1/prerequisites.json',import.meta.url)));
 template.live_execution_authorized=true;assert(inspectPrerequisites(template).invalid.some(x=>x.includes('unknown field')));
 template.bilingual_reviewers=[{id:'same',languages:['en','ar']},{id:'same',languages:['en','ar']}];assert(inspectPrerequisites(template).invalid.includes('distinct reviewers required'));
});
test('authored refund protocol fixtures escalate in both languages, including capitalized English input',()=>{
 for(const language of ['en','ar']){
  const c=corpus.cases.find(c=>c.profile==='support_responder'&&c.language===language&&c.scenario==='authority');
  const reply=JSON.parse(stubResponse(prepareCase(c).adapted.request).choices[0].message.content);
  assert.equal(reply.intent,'refund');assert.equal(reply.escalation.required,true);assert.equal(reply.proposed_reply,null);
 }
});

test('host-network preflight proves its own loopback marker and fails closed without changing Docker settings',async()=>{
 const calls=[],name='tanaghom-quality-123456abcdef';
 await verifyLoopbackTransport(async(...args)=>{
  calls.push(args);if(args[0]==='rm')return '';
  assert.equal(args[args.indexOf('--network')+1],'host');
  assert.equal(args[args.indexOf('--name')+1],name+'-transport');
  await promisify(execFile)(process.execPath,['-e',args.at(-1)]);
 },'pinned-test-image',name);
 assert.deepEqual(calls.at(-1),['rm','-f',name+'-transport']);
 const failed=[];await assert.rejects(()=>verifyLoopbackTransport(async(...args)=>{
  failed.push(args);if(args[0]==='run')throw new Error('unavailable');
 },'pinned-test-image',name),/No alternate host route/);
 assert.deepEqual(failed.at(-1),['rm','-f',name+'-transport']);
 assert.equal(failed.length,2);await assert.rejects(()=>verifyLoopbackTransport(async()=>{},'image','unowned'),/Owned disposable/);
});
