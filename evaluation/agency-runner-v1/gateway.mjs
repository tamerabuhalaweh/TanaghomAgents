// Test-only worker gateway. Not imported or served by the production dashboard.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {fingerprint} from '../../packages/agent-runtime/agency-pilot.mjs';
import {prepareComparison,finishComparison,conditionHash} from './runtime.mjs';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fail=(status)=>Object.assign(new Error('isolated_request_rejected'),{status});
export async function createQualityGateway({pool,token,manifestHash,onEmpty=async()=>{},onPrepared=()=>{},onFailure=()=>{},onTransport=()=>{}}){
  const db=(await pool.query('SELECT current_database() AS db')).rows[0].db;
  assert(/^tanaghom_quality_[a-f0-9]{12}$/.test(db),'Disposable database required');
  assert((await pool.query("SELECT has_table_privilege(current_user,'tanaghom.app_users','SELECT') AS raw")).rows[0].raw===false,'Restricted worker role required');
  assert(Buffer.byteLength(token)>=32);
  let busy=false;
  const server=createServer(async(req,res)=>{
    let client,action=null;const started=performance.now();
    onTransport({event:'received'});
    res.on('close',()=>onTransport({event:res.writableFinished?'finished':'aborted',action,status:res.statusCode,elapsed_ms:performance.now()-started}));
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});res.end(JSON.stringify(value));};
    try{
      if(req.method!=='POST'||req.url!=='/quality/worker')throw fail(404);
      const actual=Buffer.from(req.headers.authorization?.replace(/^Bearer /,'')||''),expected=Buffer.from(token);
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw fail(401);
      let size=0;const chunks=[];for await(const part of req){size+=part.length;if(size>150000)throw fail(413);chunks.push(part);}
      let command;try{command=JSON.parse(Buffer.concat(chunks));}catch{throw fail(400);}
      if(!command||typeof command!=='object'||Array.isArray(command))throw fail(400);
      const keys=Object.keys(command).sort().join(',');
      const claim=command.action==='claim'&&keys==='action';
      const complete=command.action==='complete'&&keys==='action,lease_token,model_response,task_id'&&uuid.test(command.task_id)&&uuid.test(command.lease_token);
      if(!claim&&!complete)throw fail(400);
      action=command.action;
      if(busy)throw fail(409);busy=true;
      try{
        if(claim)await onEmpty(); // Trusted fixture scheduler; never HTTP-provided code or text.
        client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query("SET LOCAL statement_timeout='10s'");
        const resolve=async(t,l)=>(await client.query('SELECT tanaghom.resolve_agency_pilot($1,$2) AS b',[t,l])).rows[0].b;
        const metadata=async(t,l)=>(await client.query('SELECT tanaghom_quality.read_attempt($1,$2) AS m',[t,l])).rows[0].m;
        if(claim){
          const t=(await client.query('SELECT * FROM tanaghom.claim_agency_pilot()')).rows[0];
          if(!t){await client.query('COMMIT');return send(200,{task:null});}
          await client.query('SAVEPOINT prepare');
          try{
            const b=await resolve(t.task_id,t.lease_token),m=await metadata(t.task_id,t.lease_token),p=prepareComparison(b,m,manifestHash);
            onPrepared(m,p,conditionHash(p.request));
            await client.query('SELECT tanaghom.seal_agency_pilot($1,$2,$3,$4)',[t.task_id,t.lease_token,b.basis_hash,p]);
            await client.query('COMMIT');return send(200,{task:{...t,request:p.request}});
          }catch(e){
            onFailure({stage:'prepare',task_id:t.task_id,error:e.message.split('\n')[0].slice(0,160)});
            await client.query('ROLLBACK TO SAVEPOINT prepare');
            await client.query("SELECT tanaghom.finish_agency_pilot($1,$2,$3,NULL,'pilot_validation_failed')",[t.task_id,t.lease_token,fingerprint({error:'comparison_preparation_failed'})]);
            await client.query('COMMIT');return send(200,{task:null,error:'comparison_preparation_failed'});
          }
        }
        const hash=fingerprint(command.model_response),previous=(await client.query('SELECT tanaghom.read_agency_pilot_completion($1,$2) AS p',[command.task_id,command.lease_token])).rows[0].p;
        if(previous){if(previous.response_hash!==hash)throw fail(409);await client.query('COMMIT');return send(200,{...previous,replay:true});}
        await client.query('SAVEPOINT finish');let result=null,error=null;
        try{result=finishComparison(await resolve(command.task_id,command.lease_token),command.model_response,
          await metadata(command.task_id,command.lease_token),manifestHash);}catch(e){onFailure({stage:'complete',task_id:command.task_id,error:e.message.split('\n')[0].slice(0,160)});await client.query('ROLLBACK TO SAVEPOINT finish');error='pilot_validation_failed';}
        const r=(await client.query('SELECT tanaghom.finish_agency_pilot($1,$2,$3,$4,$5) AS r',[command.task_id,command.lease_token,hash,result,error])).rows[0].r;
        await client.query('COMMIT');return send(200,r);
      }finally{busy=false;}
    }catch(e){onFailure({stage:'gateway',error:e.message.split('\n')[0].slice(0,160)});if(client)await client.query('ROLLBACK').catch(()=>{});send(e.status||409,{error:'isolated_request_rejected'});}
    finally{client?.release();}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  return server;
}
