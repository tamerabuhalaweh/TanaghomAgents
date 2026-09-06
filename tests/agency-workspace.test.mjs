import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workspaceManifest,workspaceRequest,workspaceArtifact,modelEndpoint } from '../packages/agent-runtime/workspace.mjs';
test('workspace deployment validates the ledger as administrator without widening API permissions',()=>{
 const probe=readFileSync('deployment/agency-workspace/validate.cjs','utf8');
 assert.doesNotMatch(probe,/query\(['"`]SELECT[^;\n]*schema_migrations/);
 const deploy=readFileSync('deployment/agency-workspace/deploy.sh','utf8');
 assert.match(deploy,/WORKSPACE_RESUME_STATE/);assert.match(deploy,/sha256sum -c/);
 assert.match(deploy,/SELECT count\(\*\) FROM tanaghom.agency_workspaces/);
 assert.match(deploy,/SELECT NOT enabled AND emergency_stop/);
 assert.match(deploy,/if ! \$resume; then/);
});
const task={profile:'social_media_strategist',language:'en',model:'gemma4-26b-a4b-canary',title:'Fictional course campaign',brief:'Prepare organic Instagram content for our course.',source_facts:'The fictional course teaches basic photography. No price or start date is confirmed.',shared_context:[],context_hash:'sha256:'+ '1'.repeat(64)};
test('workspace: six bounded profiles and no model compiler/tool request',()=>{
 assert.equal(workspaceManifest.profiles.length,6);
 const request=workspaceRequest(task,32768);
 assert.deepEqual(Object.keys(request).sort(),['max_tokens','messages','model','stream','temperature']);
 assert.equal(request.stream,false);assert.equal(request.max_tokens,1400);
 assert.equal(modelEndpoint,'https://api.thesmartlabs.net/gemma4/v1/chat/completions');
 assert.match(request.messages[0].content,/unapproved proposals/);assert.match(request.messages[0].content,/Human review/);
});
test('workspace: predecessor lineage passes as unapproved task data, never new authority',()=>{
 const input={...task,profile:'content_creator',shared_context:[{task_id:'previous',profile:'social_media_strategist',response_hash:'v1',document:'Focus on actual course features.'}]};
 const request=workspaceRequest(input,32768);
 assert.equal(JSON.parse(request.messages[1].content).previous_deliverables[0].version,'v1');
 assert.equal(JSON.parse(request.messages[1].content).previous_deliverables[0].unapproved_proposal,'Focus on actual course features.');
 assert.throws(()=>workspaceRequest(input,1000),/context_budget/);
 assert.throws(()=>workspaceRequest({...input,shared_context:Array(6).fill(input.shared_context[0])},32768),/input_invalid/);
});
test('workspace: complete model documents only; wrong model, truncation, tools and wrong language fail',()=>{
 const response={model:task.model,choices:[{finish_reason:'stop',message:{content:'A useful draft for the fictional course.'}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}};
 const artifact=workspaceArtifact(task,response,125);
 assert.equal(artifact.kind,'model_document');assert.equal(artifact.external_actions,0);assert.equal(artifact.human_approved,false);
 assert.equal(artifact.context_hash,task.context_hash);
 assert.throws(()=>workspaceArtifact(task,{...response,model:'other'},1));
 assert.throws(()=>workspaceArtifact(task,{...response,choices:[{...response.choices[0],finish_reason:'length'}]},1));
 assert.throws(()=>workspaceArtifact(task,{...response,choices:[{finish_reason:'stop',message:{content:'A document pretending to request a tool.',tool_calls:[{}]}}]},1));
 assert.throws(()=>workspaceArtifact({...task,language:'ar'},response,1),/language/);
});
test('workspace: deterministic report has no invented business metrics or model invocation',()=>{
 const report={...task,profile:'executive_summary',shared_context:[{profile:'content_creator',task_id:'source1',document:'Draft',response_hash:'v1'}]};
 assert.equal(workspaceRequest(report,32768),null);
 const result=workspaceArtifact(report,null,0);assert.equal(result.kind,'deterministic_summary');assert.equal(result.model,null);
 assert.match(result.document,/source1/);assert.match(result.document,/no measured sales/);
 assert.match(workspaceArtifact({...report,language:'ar'},null,0).document,/[\u0600-\u06ff]/);
});
test('workspace: additive migration separates simulator claims, human decisions and worker privileges',()=>{
 const sql=readFileSync('packages/database/migrations/0035_agency_workspace.up.sql','utf8');
 assert.match(sql,/agency_pilot_tasks/);assert.doesNotMatch(sql,/CREATE TABLE[^;]*workspace_tasks/);
 assert.match(sql,/workspace_contract.*IS DISTINCT FROM/);assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/stale workspace review/);assert.match(sql,/inference_outcome_unknown/);
 const grants=sql.split('\n').filter(l=>l.includes('GRANT')&&l.includes('tanaghom_agency_pilot_worker')).join('\n');
 assert.doesNotMatch(grants,/decide_agency_workspace|UPDATE|INSERT|DELETE/);
 assert.match(readFileSync('packages/database/migrations/0035_agency_workspace.down.sql','utf8'),/refuses retained evidence/);
});
