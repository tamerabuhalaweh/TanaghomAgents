// Verify the documented host-network path before creating any database fixtures.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
export async function verifyLoopbackTransport(docker,image,name){
  assert(/^tanaghom-quality-[a-f0-9]{12}$/.test(name),'Owned disposable name required');
  const marker=randomBytes(24).toString('hex'),container=name+'-transport';
  const server=createServer((req,res)=>{
    if(req.method!=='GET'||req.url!=='/'+marker)return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':'text/plain','Connection':'close'}).end(marker);
  });
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${server.address().port}/${marker}`;
    const source=`fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(5000)}).then(async r=>{
      if(!r.ok||await r.text()!==${JSON.stringify(marker)})throw new Error('loopback mismatch');
    }).catch(()=>{console.error('Disposable host loopback unavailable');process.exitCode=1;});`;
    await docker('run','--rm','--name',container,'--network','host','--memory','128m','--cpus','0.5',
      '--entrypoint','node',image,'-e',source);
  }catch{
    throw new Error('Isolated transport preflight failed: Docker host-network loopback is required. Use Linux CI or an already-enabled, verified Docker Desktop host network. No alternate host route, settings change or database startup is attempted.');
  }finally{
    server.closeAllConnections();server.close();
    await docker('rm','-f',container).catch(()=>{});
  }
}
