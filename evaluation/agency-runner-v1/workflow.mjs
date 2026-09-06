// Disposable-only derivative; the frozen committed production export is unchanged.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
function local(value){const u=new URL(value);assert(u.protocol==='http:'&&['127.0.0.1','host.docker.internal'].includes(u.hostname)&&!u.username&&!u.password);return value;}
export function buildWorkflow(gateway,model){
  local(gateway);local(model);
  const w=JSON.parse(readFileSync(new URL('../../n8n/workflows/agency-pilot/simulation.v1.json',import.meta.url)));
  w.id='agencyQualityIsolatedV1';w.name='Isolated Agency Paired Comparison';
  w.nodes=w.nodes.filter(n=>n.type!=='n8n-nodes-base.scheduleTrigger');delete w.connections['Disabled Polling'];
  for(const n of w.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest'))n.parameters.url=n.name==='Fixed Gemma Request'?model:gateway;
  // Execute one durable attempt per iteration; the gateway enforces the run cap.
  // Linked input, not a run-index guess: reports skip the model branch.
  w.nodes.find(n=>n.name==='Model Completion').parameters.jsCode=
    'const task=$("Needs Model").itemMatching(0).json.task; return [{json:{action:"complete",task_id:task.task_id,lease_token:task.lease_token,model_response:$json.statusCode===200?$json.body:null},pairedItem:{item:0}}];';
  w.connections['Complete Pilot Task']={main:[[{node:'Claim Pilot Task',type:'main',index:0}]]};
  w.settings.executionTimeout=180;
  w.meta={...w.meta,contract_version:'agency.quality-isolated-workflow.v1',runtime_mode:'simulated_model',maximum_batch_attempts:30};
  return w;
}
