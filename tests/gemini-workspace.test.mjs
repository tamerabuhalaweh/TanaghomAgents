import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createGeminiWorkspaceClient,geminiGenerateEndpoint,retryDelayFor } from '../packages/agent-runtime/gemini-workspace.mjs';

const key='fixture-only-gemini-key-1234567890';
const model='gemini-3.6-flash';
async function stub(t,handler){
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return `http://127.0.0.1:${server.address().port}`;
}
async function body(request){const chunks=[];for await(const chunk of request)chunks.push(chunk);return Buffer.concat(chunks).toString('utf8');}

test('gemini adapter: exact inventory, key header, bounded request and no key in URL',async t=>{
 let listCalls=0,generateCalls=0,seenKey='',seenBody='';
 const base=await stub(t,async(req,res)=>{
  if(req.url==='/v1beta/models?pageSize=1000'){
   listCalls++;seenKey=req.headers['x-goog-api-key'];
   res.setHeader('content-type','application/json');
   return res.end(JSON.stringify({models:[{name:'models/gemini-3.6-flash',inputTokenLimit:32768,outputTokenLimit:8192,supportedGenerationMethods:['generateContent']},{name:'models/other',inputTokenLimit:1,outputTokenLimit:1,supportedGenerationMethods:['generateContent']}]}));
  }
  if(req.url==='/v1beta/models/gemini-3.6-flash:generateContent'){
   generateCalls++;seenBody=await body(req);res.setHeader('content-type','application/json');
   return res.end(JSON.stringify({modelVersion:model,candidates:[{finishReason:'STOP',content:{parts:[{text:'Authored fixture document for the bounded adapter test.'}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:2,totalTokenCount:3}}));
  }
  res.writeHead(404);res.end();
 });
 const client=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${base}/v1beta`});
 assert.equal(geminiGenerateEndpoint(model,`${base}/v1beta`),`${base}/v1beta/models/gemini-3.6-flash:generateContent`);
 const inventory=await client.inventory(model);
 assert.deepEqual(inventory,{id:model,resource:'models/gemini-3.6-flash',inputTokenLimit:32768,outputTokenLimit:8192});
 const result=await client.generate(model,{contents:[{role:'user',parts:[{text:'fixture'}]}]});
 assert.equal(result.modelVersion,model);assert.equal(listCalls,1);assert.equal(generateCalls,1);
 assert.equal(seenKey,key);assert.equal(seenBody.includes(key),false);assert.equal(seenBody.includes('fixture'),true);
});

test('gemini adapter: 429/502/503/504 retry with Retry-After clamped into the bounded backoff',async t=>{
 for(const [transient,retryAfter,expectedDelay] of [[429,'30',25000],[502,'1',2000],[503,null,2000],[504,null,2000]]){
  let calls=0;
  const base=await stub(t,async(req,res)=>{
   req.resume();calls++;
   if(calls===1){
    res.writeHead(transient,{'content-type':'application/json',...(retryAfter?{'retry-after':retryAfter}:{})});
    return res.end(JSON.stringify({error:{message:'private provider detail'}}));
   }
   res.setHeader('content-type','application/json');
   res.end(JSON.stringify({modelVersion:model,candidates:[{finishReason:'STOP',content:{parts:[{text:'A bounded retry success document.'}]}}]}));
  });
  const delays=[];
  const client=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${base}/v1beta`,sleep:async(ms)=>{delays.push(ms);}});
  const result=await client.generate(model,{contents:[]});
  assert.equal(result.modelVersion,model);
  assert.equal(calls,2);
  assert.deepEqual(delays,[expectedDelay]);
 }
});

test('gemini adapter: inventory retries transient statuses and persistent quota fails explicitly',async t=>{
 let inventoryCalls=0;
 const base=await stub(t,async(req,res)=>{
  inventoryCalls++;req.resume();
  if(inventoryCalls===1){res.writeHead(502);return res.end('{}');}
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({models:[{name:'models/gemini-3.6-flash',inputTokenLimit:32768,outputTokenLimit:8192,supportedGenerationMethods:['generateContent']}]}));
 });
 const delays=[];
 const client=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${base}/v1beta`,sleep:async(ms)=>{delays.push(ms);}});
 const inventory=await client.inventory(model);
 assert.equal(inventory.id,model);assert.equal(inventoryCalls,2);assert.deepEqual(delays,[2000]);

 let quotaCalls=0;
 const quotaBase=await stub(t,async(req,res)=>{
  quotaCalls++;req.resume();res.writeHead(429,{'content-type':'application/json'});res.end('{}');
 });
 const quotaDelays=[];
 const quotaClient=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${quotaBase}/v1beta`,sleep:async(ms)=>{quotaDelays.push(ms);}});
 await assert.rejects(quotaClient.inventory(model),e=>e.code==='provider_quota_exceeded');
 assert.equal(quotaCalls,4);assert.deepEqual(quotaDelays,[2000,5000,10000]);
});

test('gemini adapter: Retry-After accepts positive integer seconds only and clamps to 25 seconds',()=>{
 assert.equal(retryDelayFor({headers:{get:()=> '2'}},5000),5000);
 assert.equal(retryDelayFor({headers:{get:()=> '9'}},2000),9000);
 assert.equal(retryDelayFor({headers:{get:()=> '30'}},2000),25000);
 assert.equal(retryDelayFor({headers:{get:()=> '0'}},3000),3000);
 assert.equal(retryDelayFor({headers:{get:()=> '1.5'}},3000),3000);
 assert.equal(retryDelayFor({headers:{get:()=> 'soon'}},4000),4000);
 assert.equal(retryDelayFor({},5000),5000);
});

test('gemini adapter: malformed and oversized responses are rejected without exposing provider body',async t=>{
 let calls=0;
 const base=await stub(t,async(req,res)=>{
  req.resume();res.setHeader('content-type','application/json');
  res.end(calls++===0?'{':'x'.repeat(100001));
 });
 const client=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${base}/v1beta`});
 await assert.rejects(client.generate(model,{contents:[]}),e=>e.code==='output_rejected'&&!e.message.includes('x'));
 await assert.rejects(client.generate(model,{contents:[]}),e=>e.code==='output_rejected'&&!e.message.includes('x'));
 assert.equal(calls,2);
});

test('gemini adapter: missing model, non-text model and credentials are rejected before inference',async t=>{
 let calls=0;
 const base=await stub(t,async(req,res)=>{
  calls++;req.resume();res.setHeader('content-type','application/json');
  res.end(JSON.stringify({models:[{name:'models/gemini-3.6-flash',inputTokenLimit:32768,outputTokenLimit:8192,supportedGenerationMethods:['embedContent']}]}));
 });
 const client=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${base}/v1beta`});
 await assert.rejects(client.inventory(model),e=>e.code==='model_unavailable');
 assert.throws(()=>createGeminiWorkspaceClient({apiKey:'short',baseUrl:`${base}/v1beta`}),e=>e.code==='model_unavailable');
 assert.throws(()=>createGeminiWorkspaceClient({apiKey:' leading and trailing ',baseUrl:`${base}/v1beta`}),e=>e.code==='model_unavailable');
 assert.equal(calls,1);
});
