import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const gateway = { httpHeaderAuth: { id: 'agencyPilotGatewayV1', name: 'Tanaghom Agency Pilot Gateway' } };
const gemma = { httpHeaderAuth: { id: '62000000-0000-4000-8000-000000000002', name: 'Tanaghom Gemma API' } };
const node = (name, type, parameters, extra = {}) => ({ id: name.replaceAll(' ',''), name,
  type: `n8n-nodes-base.${type}`, typeVersion: type === 'httpRequest' ? 4.2 : type === 'code' ? 2 : 1,
  position: [0,0], parameters, ...extra });
const http = (name, body) => node(name, 'httpRequest', { method: 'POST',
  url: '={{ $env.TANAGHOM_INTEGRATION_GATEWAY_URL + "/api/internal/agency-pilot" }}',
  authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true,
  specifyBody: 'json', jsonBody: body, options: { timeout: 20000 } }, { credentials: gateway });
const nodes = [node('Manual Test', 'manualTrigger', {}),
  node('Disabled Polling', 'scheduleTrigger', { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }, { disabled: true, typeVersion: 1.2 }),
  http('Claim Pilot Task', '={"action":"claim"}'),
  node('Has Task', 'if', { conditions: { boolean: [{ value1: '={{ !!$json.task }}', value2: true }] } }),
  node('Needs Model', 'if', { conditions: { boolean: [{ value1: '={{ !!$json.task.request }}', value2: true }] } }),
  node('Fixed Gemma Request', 'httpRequest', { method: 'POST', url: 'https://api.thesmartlabs.net/gemma4/v1/chat/completions',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true,
    specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.task.request) }}',
    options: { timeout: 90000, response: { response: { neverError: true, fullResponse: true, responseFormat: 'json' } } } },
    { credentials: gemma, onError: 'continueRegularOutput' }),
  node('Model Completion', 'code', { jsCode: 'const task=$("Claim Pilot Task").first().json.task; return [{json:{action:"complete",task_id:task.task_id,lease_token:task.lease_token,model_response:$json.statusCode===200?$json.body:null}}];' }),
  node('Local Completion', 'code', { jsCode: 'const task=$json.task; return [{json:{action:"complete",task_id:task.task_id,lease_token:task.lease_token,model_response:null}}];' }),
  http('Complete Pilot Task', '={{ JSON.stringify($json) }}'),
];
nodes.forEach((n,i) => { n.position=[i*220, i===1?200:0]; });
const connections = {};
const link = (from, to, index = 0) => {
  connections[from] ??= { main: [] }; connections[from].main[index] ??= [];
  connections[from].main[index].push({ node: to, type: 'main', index: 0 });
};
link('Manual Test','Claim Pilot Task'); link('Disabled Polling','Claim Pilot Task');
link('Claim Pilot Task','Has Task'); link('Has Task','Needs Model');
link('Needs Model','Fixed Gemma Request'); link('Needs Model','Local Completion',1);
link('Fixed Gemma Request','Model Completion'); link('Model Completion','Complete Pilot Task'); link('Local Completion','Complete Pilot Task');
const workflow = { id: 'agencyPilotSimulationV1', name: 'Tanaghom Agency Pilot Simulation v1', active: false,
  nodes, connections, settings: { executionOrder: 'v1', executionTimeout: 150, saveDataSuccessExecution: 'none',
    saveDataErrorExecution: 'none', saveManualExecutions: false }, tags: [],
  meta: { contract_version: 'phase7.agency-pilot-workflow.v1', mode: 'simulation', provider_execution_allowed: false,
    installation_authorized: false, customer_certified: false } };
const directory = new URL('../n8n/workflows/agency-pilot/', import.meta.url); mkdirSync(directory,{recursive:true});
writeFileSync(fileURLToPath(new URL('simulation.v1.json',directory)),JSON.stringify(workflow,null,2)+'\n');
