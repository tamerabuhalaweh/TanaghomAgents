// Exercise actual server startup, not just CLI import/execution. Own disposable
// container/volume only; no host port, credential file or model connection.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const name=`aw-startup-${randomUUID().slice(0,8)}`;
const image='docker.n8n.io/n8nio/n8n@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd';
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:8e6});
let created=false;
try{
 docker(['run','-d','--name',name,'--label','tanaghom.scope=workspace-startup-test','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
  '--memory','1024m','--cpus','1','--tmpfs','/tmp:size=64m,mode=1777','--tmpfs','/home/node/.cache:size=128m,uid=1000,gid=1000,mode=0700','-v','/home/node/.n8n',
  '-e','N8N_DIAGNOSTICS_ENABLED=false','-e','N8N_VERSION_NOTIFICATIONS_ENABLED=false','-e','N8N_PUBLIC_API_DISABLED=true','-e','N8N_COMMUNITY_PACKAGES_ENABLED=false','-e','N8N_ENCRYPTION_KEY=disposable-startup-key-0000000000000000',image]);created=true;
 let ready=false;
 for(let i=0;i<60;i++){
  const state=JSON.parse(docker(['inspect',name]))[0].State;
  if(!state.Running)throw new Error(docker(['logs','--tail','25',name]));
  try{docker(['exec',name,'node','-e',"fetch('http://127.0.0.1:5678/healthz/readiness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]);ready=true;break;}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.equal(ready,true,'n8n readiness must pass with read-only root');
 assert.equal(JSON.parse(docker(['inspect',name]))[0].RestartCount,0);
 console.log('PASS actual pinned n8n server startup: read-only root, bounded temporary cache, zero restarts, private readiness200');
}finally{if(created){assert.equal(JSON.parse(docker(['inspect',name]))[0].Config.Labels['tanaghom.scope'],'workspace-startup-test');docker(['rm','-f','-v',name]);}}
