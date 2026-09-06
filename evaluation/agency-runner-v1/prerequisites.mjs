// Documentation completeness, NEVER authorization to execute a model request.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const expected=JSON.parse(readFileSync(new URL('./prerequisites.json',import.meta.url)));
export function inspectPrerequisites(p=expected){
  const missing=[],invalid=[];
  const object=(value,template,label)=>{
    if(!value||typeof value!=='object'||Array.isArray(value)){invalid.push(label);return false;}
    for(const k of Object.keys(value))if(!Object.hasOwn(template,k))invalid.push(`${label}.${k}: unknown field`);
    return true;
  };
  if(!object(p,expected,'root'))return {complete:false,missing,invalid,live_execution_authorized:false};
  if(p.version!==expected.version)invalid.push('version');
  const text=(value,label)=>{if(value===null||value===undefined||value===''){missing.push(label);return false;}
    if(typeof value!=='string'||value.trim().length<3||value.length>500){invalid.push(label);return false;}return true;};
  const hash=(value,label)=>{if(text(value,label)&&!/^sha256:[a-f0-9]{64}$/.test(value))invalid.push(label+': immutable SHA256 required');};
  text(p.domain_approver,'domain_approver');
  if(!Array.isArray(p.bilingual_reviewers)||p.bilingual_reviewers.length!==2)missing.push('two distinct bilingual reviewers');
  else{
    for(const r of p.bilingual_reviewers){if(!object(r,{id:null,languages:null},'reviewer'))continue;text(r.id,'reviewer.id');
      if(!Array.isArray(r.languages)||r.languages.length!==2||![...new Set(r.languages)].sort().every((l,i)=>l===['ar','en'][i])||new Set(r.languages).size!==2)invalid.push('reviewer must cover en and ar');}
    if(p.bilingual_reviewers[0]?.id===p.bilingual_reviewers[1]?.id)invalid.push('distinct reviewers required');
  }
  for(const k of ['rubric_approval_ref','corpus_approval_ref','heldout_rights_ref','blind_mapping_escrow_ref',
    'isolated_environment_approval_ref','compiler_evidence_ref','bounded_probe_approval_ref'])text(p[k],k);
  for(const k of ['reference_answers_hash','heldout_hash'])hash(p[k],k);
  if(object(p.model,expected.model,'model')){
    for(const k of ['served_id','quantization','xgrammar_version'])text(p.model[k],`model.${k}`);
    for(const k of ['weights_sha256','tokenizer_sha256','chat_template_sha256'])hash(p.model[k],`model.${k}`);
    if(text(p.model.vllm_image,'model.vllm_image')&&!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(p.model.vllm_image))invalid.push('immutable model image required');
    if(p.model.context_tokens==null)missing.push('model.context_tokens');else if(!Number.isSafeInteger(p.model.context_tokens)||p.model.context_tokens<8000)invalid.push('context budget insufficient');
    if(!['supported','unsupported'].includes(p.model.seed_support))missing.push('model.seed_support');
  }
  if(object(p.resource_budget,expected.resource_budget,'resource_budget')){
    for(const [key,max] of [['memory_bytes',Number.MAX_SAFE_INTEGER],['maximum_model_requests',400],['maximum_elapsed_seconds',14400]]){
      const v=p.resource_budget[key];if(v==null)missing.push(`resource_budget.${key}`);else if(!Number.isSafeInteger(v)||v<1||v>max)invalid.push(`resource_budget.${key}`);
    }
    for(const k of ['cost_basis_ref','approval_ref'])text(p.resource_budget[k],`resource_budget.${k}`);
  }
  return {version:'agency.quality-prerequisite-inspection.v1',complete:!missing.length&&!invalid.length,missing,invalid,
    live_execution_authorized:false,note:'Recorded names/references require external verification. This checker cannot grant approval or enable transport.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(inspectPrerequisites(),null,2));
