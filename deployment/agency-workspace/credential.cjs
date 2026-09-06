const fs=require('node:fs');
const token=fs.readFileSync('/run/secrets/workspace_worker_token','utf8').trim();
if(token.length<32)throw new Error('workspace credential absent');
fs.writeFileSync(process.argv[2],JSON.stringify([{id:'76000000-0000-4000-8000-000000000035',name:'Tanaghom Workspace Gateway',type:'httpHeaderAuth',data:{name:'Authorization',value:`Bearer ${token}`}}]),{mode:0o600});
