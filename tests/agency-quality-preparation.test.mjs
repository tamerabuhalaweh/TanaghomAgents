import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { corpus, rubric, validateCorpus, prepareCase, preparePacket, screenGuidedSchema, verifyLock, lockManifest, modelPlaceholder } from '../scripts/agency-quality-preparation.mjs';

test('quality corpus covers all six profiles and both languages without pretending public reserves are blind',()=>{
  validateCorpus(); const packet=preparePacket();
  assert.equal(packet.summary.development_cases,48); assert.equal(packet.summary.public_reserve_cases,24);
  assert.equal(packet.summary.true_blind_holdout_cases,0);
  assert.equal(packet.summary.unique_guided_schemas,4);
  assert.equal(packet.summary.planned_model_attempts,324); assert.equal(packet.summary.planned_deterministic_attempts,36);
  assert.equal(packet.summary.actual_model_calls,0); assert.equal(packet.summary.quality_certified,false);
  assert.equal(packet.summary.execution_ready,false);
  for(const a of packet.planned_attempts){assert.equal(a.status,'NOT_RUN');assert.equal(a.review_scores,null);assert.equal(a.hard_failures,null);}
});
test('corpus rejects omissions, duplicates, label drift, false customer signoff and missing Arabic',()=>{
  for(const mutate of [c=>c.cases.pop(),c=>{c.cases[0]=c.cases[1]},c=>{c.cases[0].language='ar'},
    c=>{c.customer_approved=true},c=>{c.true_blind_holdout_available=true},
    c=>{c.cases.find(x=>x.language==='ar').task='No Arabic supplied in this corrupted case'},
    c=>{c.cases[0].partition='secret_holdout'}]){
    const c=structuredClone(corpus);mutate(c);assert.throws(()=>validateCorpus(c));
  }
});
test('four reused profiles compare identical model inputs/schema/budgets with only system augmentation changed',()=>{
  for(const c of corpus.cases.filter(c=>!['brand_guardian','executive_summary'].includes(c.profile))){
    const p=prepareCase(c), b=structuredClone(p.baseline.request), a=structuredClone(p.adapted.request);
    assert.equal(b.model,modelPlaceholder);assert.notEqual(a.messages[0].content,b.messages[0].content);
    b.messages[0].content=a.messages[0].content; assert.deepEqual(b,a);
  }
});
test('reference-only profiles cannot be counted as existing AI baselines',()=>{
  for(const code of ['brand_guardian','executive_summary'])for(const c of corpus.cases.filter(c=>c.profile===code)){
    const p=prepareCase(c);assert.equal(p.baseline.kind,'human_reference_required');assert.equal(p.baseline.request,null);
    assert.equal(p.baseline.reference,null);
    if(code==='executive_summary'){
      assert.equal(p.adapted.request,null);assert.equal(p.adapted.deterministic_result.human_approval_granted,false);
      assert.equal(p.adapted.deterministic_result.external_action_count,0);
    }
  }
});
test('report fixtures actually exercise missing money, conflicting observations and zero denominators',()=>{
  for(const language of ['en','ar'])for(const [scenario,reason] of [
    ['missing_evidence','missing_observation'],['authority','conflicting_or_duplicate_observations'],['edge','missing_or_zero_denominator']]){
    const c=corpus.cases.find(c=>c.profile==='executive_summary'&&c.language===language&&c.scenario===scenario);
    assert(prepareCase(c).adapted.deterministic_result.data_gaps.some(g=>g.reason===reason));
  }
});
test('brand fixtures genuinely leave unknown asset rights unresolved and never grant approval',()=>{
  for(const c of corpus.cases.filter(c=>c.profile==='brand_guardian'&&c.scenario==='missing_evidence')){
    const p=prepareCase(c);const body=JSON.parse(p.adapted.request.messages[1].content);
    assert.equal(body.input.asset_ids.length,1);assert.equal(body.language,c.language);
  }
});
test('guided schema screen rejects the known crash shape and open/invalid objects',()=>{
  for(const s of [{type:'object',properties:{},minProperties:1},{type:'object'},
    {type:'object',properties:{x:{type:'string'}},additionalProperties:true},
    {type:'object',properties:{x:{type:'string'}},additionalProperties:false,required:['y']},
    {type:'array',items:{type:'object',properties:{},minProperties:1}}])assert.throws(()=>screenGuidedSchema(s));
  assert(screenGuidedSchema({type:'object',properties:{x:{type:'string'}},additionalProperties:false,required:['x']}));
});
test('source freeze is reproducible and changed sources cannot silently keep the lock',()=>{
  verifyLock();const changed=lockManifest();changed.references[0].sha256='0'.repeat(64);
  assert.throws(()=>verifyLock(changed),/drift/);
  const missing=lockManifest();missing.references.pop();assert.throws(()=>verifyLock(missing),/drift/);
});
test('offline packet regenerates identical case/request hashes and never fabricates measured results',()=>{
  assert.deepEqual(preparePacket(),preparePacket());
  const attempts=preparePacket().planned_attempts;
  assert.equal(new Set(attempts.map(a=>`${a.case_id}:${a.arm}:${a.repetition}`)).size,324);
  for(const a of attempts)for(const k of ['output_hash','latency_ms','prompt_tokens','completion_tokens','peak_memory_bytes','cost'])assert.equal(a[k],null);
});
test('rubric cannot reward simulated output or hide critical failure behind an average',()=>{
  assert.equal(rubric.status,'proposed_not_approved');assert.equal(rubric.approval.rubric_approval_ref,null);
  assert.equal(rubric.quality_gates.critical_failures_allowed,0);assert(rubric.quality_gates.human_domain_review_required);
  assert(rubric.hard_failures.includes('cross_tenant_disclosure'));assert(rubric.hard_failures.includes('false_provider_completion'));
  assert.equal(rubric.resource_proposal.max_provider_actions,0);assert.equal(rubric.resource_proposal.max_automatic_retries,0);
});
test('preparation has no credential loader or transport and rejects a live flag',()=>{
  const script=fileURLToPath(new URL('../scripts/agency-quality-preparation.mjs',import.meta.url));
  const text=readFileSync(script,'utf8');
  assert(!/process\.env|\bfetch\(|https?:\/\/|from ['"](?:node:)?(?:https?|net|child_process)['"]/.test(text));
  const result=spawnSync(process.execPath,[script,'--live'],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Offline flags only/);
});
