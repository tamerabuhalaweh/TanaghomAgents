import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createGeminiWorkspaceClient,geminiGenerateEndpoint } from '../packages/agent-runtime/gemini-workspace.mjs';

const key='fixture-only-gemini-key-1234567890';
const model='gemini-2.5-flash';
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
   return res.end(JSON.stringify({models:[{name:'models/gemini-2.5-flash',inputTokenLimit:32768,outputTokenLimit:8192,supportedGenerationMethods:['generateContent']},{name:'models/other',inputTokenLimit:1,outputTokenLimit:1,supportedGenerationMethods:['generateContent']}]}));
  }
  if(req.url==='/v1beta/models/gemini-2.5-flash:generateContent'){
   generateCalls++;seenBody=await body(req);res.setHeader('content-type','application/json');
   return res.end(JSON.stringify({modelVersion:model,candidates:[{finishReason:'STOP',content:{parts:[{text:'Authored fixture document for the bounded adapter test.'}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:2,totalTokenCount:3}}));
  }
  res.writeHead(404);res.end();
 });
 const client=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${base}/v1beta`});
 assert.equal(geminiGenerateEndpoint(model,`${base}/v1beta`),`${base}/v1beta/models/gemini-2.5-flash:generateContent`);
 const inventory=await client.inventory(model);
 assert.deepEqual(inventory,{id:model,resource:'models/gemini-2.5-flash',inputTokenLimit:32768,outputTokenLimit:8192});
 const result=await client.generate(model,{contents:[{role:'user',parts:[{text:'fixture'}]}]});
 assert.equal(result.modelVersion,model);assert.equal(listCalls,1);assert.equal(generateCalls,1);
 assert.equal(seenKey,key);assert.equal(seenBody.includes(key),false);assert.equal(seenBody.includes('fixture'),true);
});

test('gemini adapter: quota, reject, unavailable and uncertain failures are explicit with no retry',async t=>{
 const statuses=[429,400,404,503];
 let calls=0;
 const base=await stub(t,async(req,res)=>{
  const status=statuses[Math.min(calls,statuses.length-1)];calls++;req.resume();
  res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'private provider detail'}}));
 });
 const client=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${base}/v1beta`});
 await assert.rejects(client.generate(model,{contents:[]}),e=>e.code==='provider_quota_exceeded');
 await assert.rejects(client.generate(model,{contents:[]}),e=>e.code==='provider_request_rejected');
 await assert.rejects(client.generate(model,{contents:[]}),e=>e.code==='model_unavailable');
 await assert.rejects(client.generate(model,{contents:[]}),e=>e.code==='inference_outcome_unknown');
 assert.equal(calls,4);
});

test('gemini adapter: inventory quota is explicit and not retried',async t=>{
 let calls=0;
 const base=await stub(t,async(req,res)=>{
  calls++;req.resume();res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'private provider detail'}}));
 });
 const client=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${base}/v1beta`});
 await assert.rejects(client.inventory(model),e=>e.code==='provider_quota_exceeded');
 assert.equal(calls,1);
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
  res.end(JSON.stringify({models:[{name:'models/gemini-2.5-flash',inputTokenLimit:32768,outputTokenLimit:8192,supportedGenerationMethods:['embedContent']}]}));
 });
 const client=createGeminiWorkspaceClient({apiKey:key,baseUrl:`${base}/v1beta`});
 await assert.rejects(client.inventory(model),e=>e.code==='model_unavailable');
 assert.throws(()=>createGeminiWorkspaceClient({apiKey:'short',baseUrl:`${base}/v1beta`}),e=>e.code==='model_unavailable');
 assert.throws(()=>createGeminiWorkspaceClient({apiKey:' leading and trailing ',baseUrl:`${base}/v1beta`}),e=>e.code==='model_unavailable');
 assert.equal(calls,1);
});
