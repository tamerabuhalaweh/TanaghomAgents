import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workspaceManifest,workspaceRequest,workspaceArtifact } from '../packages/agent-runtime/workspace.mjs';
test('workspace deployment validates the ledger as administrator without widening API permissions',()=>{
 const probe=readFileSync('deployment/agency-workspace/validate.cjs','utf8');
 assert.doesNotMatch(probe,/query\(['"`]SELECT[^;\n]*schema_migrations/);
 const deploy=readFileSync('deployment/agency-workspace/deploy.sh','utf8');
 assert.match(deploy,/WORKSPACE_RESUME_STATE/);assert.match(deploy,/sha256sum -c/);
 assert.match(deploy,/SELECT count\(\*\) FROM tanaghom\.agency_workspaces/);
 assert.match(deploy,/SELECT NOT enabled AND emergency_stop/);
 assert.match(deploy,/if ! \$resume; then/);
 const compose=readFileSync('deployment/agency-workspace/compose.yml','utf8');
 assert.match(compose,/read_only: true/);
 assert.match(compose,/\/home\/node\/\.cache:size=128m,uid=1000,gid=1000,mode=0700/);
 assert.match(deploy,/w\.active!==0\|\|n!==0/);
});
const task={profile:'social_media_strategist',language:'en',model:'gemini-2.5-flash',title:'Fictional course campaign',brief:'Prepare organic Instagram content for our course.',source_facts:'The fictional course teaches basic photography. No price or start date is confirmed.',shared_context:[],context_hash:'sha256:'+ '1'.repeat(64)};
const gemini=(text,overrides={})=>({modelVersion:task.model,candidates:[{finishReason:'STOP',index:0,content:{parts:[{text}]}}],
 usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20},...overrides});
test('workspace: six bounded profiles and no model compiler/tool request',()=>{
 assert.equal(workspaceManifest.profiles.length,6);
 assert.deepEqual(workspaceManifest.provider,{code:'google_gemini',name:'Google Gemini',model:'gemini-2.5-flash'});
 const request=workspaceRequest(task,32768);
 assert.deepEqual(Object.keys(request).sort(),['contents','generationConfig','systemInstruction']);
 assert.deepEqual(request.generationConfig,{temperature:0.3,maxOutputTokens:1400,responseMimeType:'text/plain',thinkingConfig:{thinkingBudget:0}});
 assert.match(request.systemInstruction.parts[0].text,/unapproved proposals/);
 assert.match(request.systemInstruction.parts[0].text,/Human review/);
 assert.match(request.systemInstruction.parts[0].text,/chain-of-thought/);
 assert.equal('model' in request,false);assert.equal('tools' in request,false);assert.equal('stream' in request,false);
});
test('workspace: predecessor lineage passes as unapproved task data, never new authority',()=>{
 const input={...task,profile:'content_creator',shared_context:[{task_id:'previous',profile:'social_media_strategist',response_hash:'v1',document:'Focus on actual course features.'}]};
 const request=workspaceRequest(input,32768);
 const payload=JSON.parse(request.contents[0].parts[0].text);
 assert.equal(payload.previous_deliverables[0].version,'v1');
 assert.equal(payload.previous_deliverables[0].unapproved_proposal,'Focus on actual course features.');
 assert.throws(()=>workspaceRequest(input,1000),/context_budget/);
 assert.throws(()=>workspaceRequest(input,32768,1024),/context_budget/);
 assert.throws(()=>workspaceRequest({...input,shared_context:Array(6).fill(input.shared_context[0])},32768),/input_invalid/);
});
test('workspace: complete Gemini documents only; wrong model, truncation, tools and wrong language fail',()=>{
 const artifact=workspaceArtifact(task,gemini('A useful draft for the fictional course.'),125);
 assert.equal(artifact.kind,'model_document');assert.equal(artifact.provider,'Google Gemini');
 assert.equal(artifact.model,'gemini-2.5-flash');assert.equal(artifact.external_actions,0);assert.equal(artifact.human_approved,false);
 assert.equal(artifact.context_hash,task.context_hash);assert.deepEqual(artifact.usage,{prompt_tokens:10,completion_tokens:10,total_tokens:20});
 assert.throws(()=>workspaceArtifact(task,gemini('A useful draft for the fictional course.',{modelVersion:'other'}),1),/output_rejected/);
 assert.throws(()=>workspaceArtifact(task,gemini('A useful draft for the fictional course.',{modelVersion:'gemini-2.5-flash-lite'}),1),/output_rejected/);
 assert.equal(workspaceArtifact(task,gemini('A useful draft for the fictional course.',{modelVersion:'gemini-2.5-flash-001'}),1).model,'gemini-2.5-flash-001');
 assert.throws(()=>workspaceArtifact(task,gemini('A useful draft for the fictional course.',{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'A useful draft for the fictional course.'}]}}]}),1),/output_rejected/);
 assert.throws(()=>workspaceArtifact(task,gemini('A useful draft for the fictional course.',{candidates:[{finishReason:'STOP',content:{parts:[{functionCall:{name:'publish'}}]}}]}),1),/output_rejected/);
 assert.throws(()=>workspaceArtifact({...task,language:'ar'},gemini('A useful draft for the fictional course.'),1),/language/);
});
test('workspace: provider safety/block failures stay explicit and thought text is not stored',()=>{
 assert.throws(()=>workspaceArtifact(task,{promptFeedback:{blockReason:'SAFETY'}},1),e=>e.code==='provider_request_rejected');
 assert.throws(()=>workspaceArtifact(task,gemini('A useful draft for the fictional course.',{candidates:[{finishReason:'SAFETY',content:{parts:[]}}]}),1),e=>e.code==='provider_request_rejected');
 const artifact=workspaceArtifact(task,gemini('',{candidates:[{finishReason:'STOP',content:{parts:[{text:'private reasoning',thought:true},{text:'A useful draft for the fictional course.'}]}}]}),1);
 assert.equal(artifact.document,'A useful draft for the fictional course.');
});
test('workspace: deterministic report has no invented business metrics or model invocation',()=>{
 const report={...task,profile:'executive_summary',shared_context:[{profile:'content_creator',task_id:'source1',document:'Draft',response_hash:'v1'}]};
 assert.equal(workspaceRequest(report,32768),null);
 const result=workspaceArtifact(report,null,0);assert.equal(result.kind,'deterministic_summary');assert.equal(result.model,null);assert.equal(result.provider,null);
 assert.match(result.document,/source1/);assert.match(result.document,/no measured sales/);
 assert.match(workspaceArtifact({...report,language:'ar'},null,0).document,/[\u0600-\u06ff]/);
});
test('workspace: additive Gemini migration separates simulator claims, human decisions and worker privileges',()=>{
 const sql=readFileSync('packages/database/migrations/0035_agency_workspace.up.sql','utf8');
 assert.match(sql,/agency_pilot_tasks/);assert.doesNotMatch(sql,/CREATE TABLE[^;]*workspace_tasks/);
 assert.match(sql,/workspace_contract.*IS DISTINCT FROM/);assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/stale workspace review/);assert.match(sql,/inference_outcome_unknown/);
 const grants=sql.split('\n').filter(l=>l.includes('GRANT')&&l.includes('tanaghom_agency_pilot_worker')).join('\n');
 assert.doesNotMatch(grants,/decide_agency_workspace|UPDATE|INSERT|DELETE/);
 assert.match(readFileSync('packages/database/migrations/0035_agency_workspace.down.sql','utf8'),/refuses retained evidence/);
});
test('workspace: migration 0048 registers Gemini without replacing the Gemma profile',()=>{
 const up=readFileSync('packages/database/migrations/0048_gemini_workspace_model.up.sql','utf8');
 const down=readFileSync('packages/database/migrations/0048_gemini_workspace_model.down.sql','utf8');
 assert.match(up,/0047_smartlabs_audio/);
 assert.match(up,/gemini_2_5_flash_workspace_v1/);
 assert.match(up,/gemini-2.5-flash/);
 assert.match(up,/agency\.workspace\.document\.v1/);
 assert.match(up,/7d000000-0000-4000-8000-000000000003/);
 assert.match(up,/provider_request_rejected/);
 assert.match(up,/provider_quota_exceeded/);
 assert.doesNotMatch(up,/DELETE FROM tanaghom\.agent_runtime_profiles/);
 assert.match(down,/refuses.*referenced by inference evidence/i);
 assert.match(down,/DELETE FROM public\.schema_migrations WHERE version='0048_gemini_workspace_model'/);
});
