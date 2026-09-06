import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCommand, validateEvidence } from '../packages/agent-runtime/integration.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('pilot owner commands cannot submit authority, snapshots, prompts or tenant IDs',()=>{
  const bind={action:'bind',agent_version_id:'a6000000-0000-4000-8000-000000000001',profile_code:'content_creator'};
  assert.deepEqual(validateCommand(bind),bind);
  for(const k of ['organization_id','snapshot','instructions','approved','provider_execution_allowed','url'])
    assert.throws(()=>validateCommand({...bind,[k]:'untrusted'}));
  assert.throws(()=>validateCommand({...bind,profile_code:'arbitrary_agent'}));
});
test('typed evidence rejects executable or fabricated approval metadata',()=>{
  const rule={language:'en',check:'required_phrase',phrase:'test',category:'tone',severity:'warning',correction:'Use approved wording.'};
  validateEvidence('brand_rule',rule);
  assert.throws(()=>validateEvidence('brand_rule',{...rule,execute:'anything'}));
  assert.throws(()=>validateEvidence('metric',{value:10}));
  assert.throws(()=>validateCommand({action:'approve_evidence',kind:'brand_rule',record:rule,approved_by:'someone'}));
});
test('report command validation is repeatable and bounded',()=>{
  const id='a6000000-0000-4000-8000-000000000001';
  const command={action:'queue',binding_id:id,model_profile_id:id,target_id:null,language:'en',evidence_ids:[],idempotency_key:'test-replay-1',
    options:{window_start:'2026-09-01T00:00:00Z',window_end:'2026-09-02T00:00:00Z',metric_codes:['drafts']}};
  for(let i=0;i<3;i++)assert.deepEqual(validateCommand(command),command);
  assert.throws(()=>validateCommand({...command,options:{...command.options,metric_codes:['invented_roi']}}));
});
test('pilot workflow is inactive, fixed-route, credential-reference-only and schedule-disabled',()=>{
  const w=JSON.parse(read('n8n/workflows/agency-pilot/simulation.v1.json'));
  assert.equal(w.active,false);assert.equal(w.meta.provider_execution_allowed,false);
  assert(w.nodes.find(n=>n.type==='n8n-nodes-base.scheduleTrigger').disabled);
  const transports=w.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest');assert.equal(transports.length,3);
  for(const n of transports){assert(n.credentials.httpHeaderAuth.id);assert(!n.credentials.httpHeaderAuth.data);}
  assert.equal(transports.find(n=>n.name==='Fixed Gemma Request').parameters.url,'https://api.thesmartlabs.net/gemma4/v1/chat/completions');
  assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.saveDataErrorExecution,'none');
  assert(!w.nodes.some(n=>/executeCommand|ssh|readWriteFile/.test(n.type)));
});
test('new gateway is default-off, bounded and separately authenticated with no raw error logging',()=>{
  const s=read('apps/dashboard/lib/server/agency-pilot.ts');
  assert(s.includes('authorize(request, ["owner"])'));assert(s.includes('enforceSameOriginForCookieMutation'));
  assert(s.includes('timingSafeEqual'));assert(s.includes('AGENCY_PILOT_DATABASE_URL'));assert(s.includes('SERIALIZABLE'));
  assert(s.includes('await reader.cancel()'));assert(!/console\.(error|log|warn)/.test(s));
});
