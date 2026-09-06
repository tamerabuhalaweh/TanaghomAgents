// Fixed, isolated comparison adapter. Original production modules stay frozen.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareTask,completeTask} from '../../packages/agent-runtime/integration.mjs';
import {fingerprint} from '../../packages/agent-runtime/agency-pilot.mjs';
import {corpus,bundleFor,verifyLock,screenGuidedSchema} from '../../scripts/agency-quality-preparation.mjs';
const skills=JSON.parse(readFileSync(new URL('../../config/skill-registry.v1.json',import.meta.url))).skills;
const codes=new Set(['social_media_strategist','content_creator','discovery_coach','support_responder']);
export const modelName='agency-quality-simulated-model-v1';
export function validateAttempt(meta,bundle,manifestHash){
  verifyLock();
  assert(meta && meta.manifest_hash===manifestHash && meta.execution_kind==='simulated_model','Unregistered isolated attempt');
  assert.equal(meta.task_id,bundle.task.id);assert.equal(meta.profile_code,bundle.data.binding.profile_code);
  assert.equal(meta.language,bundle.task.language);assert.equal(bundle.data.model.model_name,modelName,'Unapproved model');
  const c=corpus.cases.find(c=>c.id===meta.case_id);assert(c && c.profile===meta.profile_code && c.language===meta.language);
  assert.equal(meta.case_hash,fingerprint(c));
  // Compare semantic fixture material, not database-generated trace/record IDs.
  const expected=bundleFor(c).data,actual=bundle.data;
  const take=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o?.[k]]));
  if(expected.records.campaign){
    assert.deepEqual(take(actual.records.campaign,['name','brief','product_type','target_audience']),take(expected.records.campaign,['name','brief','product_type','target_audience']),'Frozen campaign material changed');
    assert.equal(Number(actual.records.campaign.budget_target),0);
    if(expected.records.strategy){const keys=['version','positioning','key_messages','channels','posting_cadence','content_pillars'];
      assert.deepEqual(take(actual.records.strategy,keys),take(expected.records.strategy,keys),'Frozen strategy changed');}
  }else if(expected.records.content){
    assert.equal(actual.records.content.draft_copy,expected.records.content.draft_copy,'Frozen content changed');
    assert.equal(Boolean(actual.records.content.media_url),Boolean(expected.records.content.media_url));
  }else if(expected.records.event){
    assert.equal(actual.records.event.payload.details.body,c.task,'Frozen inbound task changed');
    assert.deepEqual(actual.records.knowledge.map(k=>k.content),[c.facts],'Frozen approved knowledge changed');
  }
  const material=d=>d.evidence.map(e=>fingerprint({kind:e.kind,record:e.record})).sort();
  assert.deepEqual(material(actual),material(expected),'Frozen typed evidence changed');
  if(c.profile==='executive_summary')assert.deepEqual(bundle.task.options,bundleFor(c).task.options);
  assert(['baseline','adapted'].includes(meta.arm));assert(meta.arm==='adapted'||codes.has(meta.profile_code),'No AI reference baseline');
  assert(Number.isInteger(meta.repetition)&&meta.repetition>=1&&meta.repetition<=3);
  return c;
}
export function prepareComparison(bundle,meta,manifestHash){
  validateAttempt(meta,bundle,manifestHash);
  const p=prepareTask(bundle), originalHash=fingerprint(p.request);
  if(meta.arm==='baseline'){
    p.request.messages[0].content=skills.find(s=>s.code===bundle.data.profile.skill_code).version.instructions;
    // Keep the shared safety validator, but do not claim that the Agency
    // procedure ran in the baseline arm's generation provenance.
  }
  if(p.request)screenGuidedSchema(p.request.response_format.json_schema.schema);
  p.comparison={version:'agency.comparison.v1',...meta,request_hash:fingerprint(p.request),
    adapted_request_hash:originalHash,system_instruction_hash:p.request?fingerprint(p.request.messages[0].content):null,
    runtime_mode:'simulated_model',quality_certified:false};
  return p;
}
export function finishComparison(bundle,response,meta,manifestHash){
  validateAttempt(meta,bundle,manifestHash);
  assert.deepEqual(bundle.task.prepared.comparison,prepareComparison(bundle,meta,manifestHash).comparison,'Comparison metadata changed');
  const result=completeTask(bundle,response);
  const comparison=bundle.task.prepared.comparison;
  // Preserve validation provenance separately and explicitly label generation.
  const {procedure_hash:validationProcedure,...rest}=result;
  return {...rest,comparison,validation_procedure_hash:validationProcedure??bundle.data.profile.procedure_hash,
    generation_procedure_hash:meta.arm==='adapted'?bundle.data.profile.procedure_hash:null,
    generation_instruction_hash:comparison.system_instruction_hash,quality_certified:false};
}
export function conditionHash(request){
  if(!request)return fingerprint(null);
  const copy=structuredClone(request);copy.messages[0].content='[system-arm-difference]';
  const input=JSON.parse(copy.messages.at(-1).content);
  // These trace-only values must differ for independent database leases.
  // Do not normalize campaign/strategy/event/evidence identities or facts.
  if(input.job_id)input.job_id='[independent-task-id]';
  if(input.correlation_id)input.correlation_id='[independent-correlation-id]';
  copy.messages[copy.messages.length-1].content=JSON.stringify(input);
  return fingerprint(copy);
}
export function buildSchedule(repetitions=3){
  assert(Number.isInteger(repetitions)&&repetitions>=1&&repetitions<=3);
  const attempts=[];
  const ordered=[...corpus.cases].sort((a,b)=>(a.profile+':'+a.scenario+':'+a.language).localeCompare(b.profile+':'+b.scenario+':'+b.language,'en'));
  for(const c of ordered)for(let i=0;i<repetitions;i++){
    const arms=codes.has(c.profile)?(i%2?['adapted','baseline']:['baseline','adapted']):['adapted'];
    for(const arm of arms)attempts.push({case_id:c.id,profile_code:c.profile,language:c.language,arm,repetition:i+1,case_hash:fingerprint(c)});
  }
  return attempts;
}
