import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8').replaceAll('\r\n','\n');
export function runnerLock(){
 const files=['evaluation/agency-v1/source-lock.json','evaluation/agency-runner-v1/isolated.sql',
  'evaluation/agency-runner-v1/runtime.mjs','evaluation/agency-runner-v1/gateway.mjs','evaluation/agency-runner-v1/fixtures.mjs',
  'evaluation/agency-runner-v1/workflow.mjs','evaluation/agency-runner-v1/prerequisites.mjs','evaluation/agency-runner-v1/prerequisites.json',
  'evaluation/agency-runner-v1/RUNBOOK.md','evaluation/agency-runner-v1/manifest.mjs',
  'scripts/agency-quality-runner.mjs','tests/agency-quality-runner.test.mjs'];
 return {version:'agency.isolated-runner-source-lock.v1',accepted_preparation_commit:'7317b2e085f0b80d12bc0fb2c862d247716600a9',
  normalization:'UTF-8, CRLF normalized to LF',files:files.sort().map(p=>({path:p,sha256:createHash('sha256').update(read(p)).digest('hex')}))};
}
export function verifyRunnerLock(value=JSON.parse(read('evaluation/agency-runner-v1/source-lock.json'))){assert.deepEqual(value,runnerLock(),'Runner source drift requires reviewed lock update');return value;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(runnerLock(),null,2));
