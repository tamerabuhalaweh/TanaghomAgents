import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const image='docker.n8n.io/n8nio/n8n@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd';
const id=`aw-${randomUUID().slice(0,8)}`,network=`${id}-net`,gateway=`${id}-gateway`,worker=`${id}-worker`;
const docker=args=>{try{return execFileSync('docker',args,{encoding:'utf8',maxBuffer:8e6,timeout:180000});}catch(error){throw new Error(String(error.stdout||error.stderr||error.message).slice(-5000));}};
const workflow=JSON.parse(readFileSync('n8n/workflows/agency/agency-workspace.v1.json','utf8'));
assert.equal(workflow.active,false);assert.equal(workflow.nodes.length,3);assert.equal(workflow.nodes.find(n=>n.type==='n8n-nodes-base.httpRequest').retryOnFail,false);
try{
 docker(['network','create','--internal','--label','tanaghom.scope=workspace-n8n-test',network]);
 const server=`const http=require('http');let calls=0;http.createServer((q,r)=>{if(q.url==='/count'){r.end(String(calls));return;}let b='';q.on('data',c=>b+=c);q.on('end',()=>{if(q.url!=='/api/internal/agency-workspace'||q.method!=='POST'||q.headers.authorization!=='Bearer disposable-workspace-test-token'||JSON.parse(b).action!=='tick'){r.writeHead(403).end();return;}calls++;r.setHeader('Content-Type','application/json');r.end(JSON.stringify({claimed:false,fixture:true}));});}).listen(3000,'0.0.0.0');`;
 docker(['run','-d','--name',gateway,'--label','tanaghom.scope=workspace-n8n-test','--network',network,'--network-alias','dashboard','--memory','256m','--cpus','0.5','--entrypoint','node',image,'-e',server]);
 const credential=JSON.stringify([{id:'76000000-0000-4000-8000-000000000035',name:'Tanaghom Workspace Gateway',type:'httpHeaderAuth',data:{name:'Authorization',value:'Bearer disposable-workspace-test-token'}}]);
 // Authored test secret only; no secret file or production environment loaded.
 const prepare=`require('fs').writeFileSync('/tmp/credential.json',process.env.TEST_CREDENTIAL,{mode:0o600});`;
 const output=docker(['run','--name',worker,'--label','tanaghom.scope=workspace-n8n-test','--network',network,'--memory','1024m','--cpus','1',
  '-v',`${resolve('n8n/workflows/agency/agency-workspace.v1.json')}:/workflow.json:ro`,
  '-e',`TEST_CREDENTIAL=${credential}`,'-e',`TEST_PREPARE=${prepare}`,'-e','N8N_ENCRYPTION_KEY=disposable-encryption-key-only-00000000','-e','N8N_SSRF_PROTECTION_ENABLED=true','-e','N8N_SSRF_ALLOWED_HOSTNAMES=dashboard','-e','N8N_DIAGNOSTICS_ENABLED=false','-e','N8N_VERSION_NOTIFICATIONS_ENABLED=false','-e','N8N_BLOCK_ENV_ACCESS_IN_NODE=true','--entrypoint','/bin/sh',image,'-c',
  'set -eu; node -e "$TEST_PREPARE"; n8n import:credentials --input=/tmp/credential.json; rm /tmp/credential.json; n8n import:workflow --input=/workflow.json; n8n execute --id=tanaghomAgencyWorkspaceV1']);
 assert.match(output,/Execution was successful|Execution success/i);
 const count=docker(['exec',gateway,'node','-e',"fetch('http://127.0.0.1:3000/count').then(r=>r.text()).then(console.log)"]).trim();assert.equal(count,'1');
 console.log('PASS pinned n8n 2.26.8 imported inactive export, encrypted header credential, actual HTTP node dispatched exactly one authenticated request; real inference/provider actions=0');
}finally{
 for(const name of [worker,gateway]){let info;try{info=JSON.parse(docker(['inspect',name]))[0];}catch{continue;}assert.equal(info.Config.Labels['tanaghom.scope'],'workspace-n8n-test');docker(['rm','-f','-v',name]);}
 let info;try{info=JSON.parse(docker(['network','inspect',network]))[0];}catch{}if(info){assert.equal(info.Labels['tanaghom.scope'],'workspace-n8n-test');docker(['network','rm',network]);}
}
