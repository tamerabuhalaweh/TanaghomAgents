import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
const load = () => import('../packages/agent-runtime/providers/smartlabs.mjs');
async function stub(t, handler) {
 const server=createServer(handler); server.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 return `http://127.0.0.1:${server.address().port}`;
}
const config=url=>({gemmaBaseUrl:url,gemmaKey:'dummy-test-secret',model:'gemma4-26b-a4b-canary',apiBaseUrl:url,apiKey:'dummy-test-secret',asrUrl:url+'/transcriptions',ttsBackend:'omnivoice',voiceId:'smarttts2-xms-default',language:'ar',gemmaEnabled:true,ttsEnabled:true,asrEnabled:true});
const seams={ownedLoopbackTest:true,tokenCounter:()=>5,thinkingDisabled:true};

const sourceId='11111111-1111-4111-8111-111111111111';
test('ASR tracer: trusted controlled asset reader, exact multipart and linked Arabic transcript',async t=>{
 let calls=0,reads=0;const bytes=wav();const {createHash}=await import('node:crypto');const hash=createHash('sha256').update(bytes).digest('hex');
 const url=await stub(t,async(req,res)=>{calls++;assert.equal(req.url,'/transcriptions');assert.equal(req.headers['x-api-key'],'dummy-test-secret');const chunks=[];for await(const c of req)chunks.push(c);const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':req.headers['content-type']}}).formData();assert.deepEqual([...form.keys()],['file','language']);assert.equal(form.get('language'),'ar');assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()),bytes);res.setHeader('content-type','application/json');res.end(JSON.stringify({text:'مرحبا بالعالم',language:'ar',duration:0.1,processing_time_ms:2,request_id:'asr-id'}));});
 const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),{...seams,readControlledAudio:async id=>{reads++;assert.equal(id,sourceId);return {bytes,mime:'audio/wav',sha256:hash,versionId:sourceId,assetId:sourceId,jobId:sourceId};}});assert.equal(typeof a.asr?.transcribe,'function');
 const out=await a.asr.transcribe({sourceVersionId:sourceId});assert.equal(out.text,'مرحبا بالعالم');assert.equal(out.source.versionId,sourceId);assert.equal(out.source.sha256,hash);assert.equal(out.metadata.requestId,'asr-id');assert.equal(calls,1);assert.equal(reads,1);
 await assert.rejects(a.asr.transcribe({bytes}),e=>e.code==='unsupported_input');assert.equal(calls,1);
});


test('compressed audio decoder fails closed without a pinned executable, denies remote containers',async()=>{
 const m=await import('../packages/agent-runtime/adapters/decode-audio.mjs');assert.equal(typeof m.createBoundedAudioDecoder,'function');
 assert.throws(()=>m.createBoundedAudioDecoder({}),e=>e.code==='decoder_pin_required');
});


test('real pinned decoder consumes full MP3/Ogg/FLAC/AAC sample streams and refuses decoded overflow', {skip:!process.env.SMARTLABS_TEST_FFMPEG},async()=>{
 const {spawnSync}=await import('node:child_process');const {readFileSync}=await import('node:fs');const {createHash}=await import('node:crypto');
 const path=process.env.SMARTLABS_TEST_FFMPEG,sha256=createHash('sha256').update(readFileSync(path)).digest('hex');const {createBoundedAudioDecoder}=await import('../packages/agent-runtime/adapters/decode-audio.mjs');const inspect=createBoundedAudioDecoder({path,sha256});
 for(const [format,codec,mime] of [['mp3','libmp3lame','audio/mpeg'],['ogg','libvorbis','audio/ogg'],['ogg','libopus','audio/ogg'],['flac','flac','audio/flac'],['adts','aac','audio/aac']]){
  const encoded=spawnSync(path,['-hide_banner','-loglevel','error','-f','wav','-i','pipe:0','-c:a',codec,'-f',format,'pipe:1'],{input:wav(0.5),maxBuffer:2000000,timeout:10000});assert.equal(encoded.status,0,encoded.stderr?.toString());
  const info=await inspect(encoded.stdout);assert.equal(info.mime,mime);assert.ok(info.duration>=0.48&&info.duration<0.8,`${format}: ${info.duration}`);
 }
 const unsupported=spawnSync(path,['-hide_banner','-loglevel','error','-f','wav','-i','pipe:0','-c:a','libspeex','-f','ogg','pipe:1'],{input:wav(0.5),maxBuffer:2000000,timeout:10000});assert.equal(unsupported.status,0);await assert.rejects(inspect(unsupported.stdout),e=>e.code==='audio_invalid');
 const tooLong=spawnSync(path,['-hide_banner','-loglevel','error','-f','wav','-i','pipe:0','-c:a','flac','-f','flac','pipe:1'],{input:wav(20.1),maxBuffer:2000000,timeout:10000});assert.equal(tooLong.status,0);await assert.rejects(inspect(tooLong.stdout),e=>e.code==='audio_duration_exceeded');
 await assert.rejects(inspect(Buffer.from('#EXTM3U\nhttps://invalid.example/a.mp3')),e=>e.code==='audio_format_unsupported');
 await assert.rejects(inspect(Buffer.from('....ftypisom')),e=>e.code==='audio_format_unsupported');
 await assert.rejects(createBoundedAudioDecoder({path,sha256:'0'.repeat(64)})(Buffer.from('ID3bad')),e=>e.code==='decoder_pin_mismatch');
});


test('provider response cannot echo credentials through content or metadata',async t=>{
 const url=await stub(t,(req,res)=>{res.setHeader('content-type','application/json');res.setHeader('x-request-id','dummy-test-secret');res.end(JSON.stringify({model:'gemma4-26b-a4b-canary',choices:[{message:{role:'assistant',content:'dummy-test-secret'},finish_reason:'stop'}]}));});
 const {createSmartLabsAdapters}=await load();await assert.rejects(createSmartLabsAdapters(config(url),seams).gemma.complete({messages:[{role:'user',content:'مرحبا'}]}),e=>e.code==='response_secret_rejected'&&!JSON.stringify(e).includes('dummy-test-secret'));
});


test('429 Retry-After blocks a fresh call locally instead of creating a retry storm',async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;res.writeHead(429,{'retry-after':'2'});res.end('upstream secret dummy-test-secret');});const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),seams);
 await assert.rejects(a.gemma.models(),e=>e.status===429&&e.metadata.retryAfterSeconds===2&&!JSON.stringify(e).includes('dummy-test-secret'));
 await assert.rejects(a.gemma.models(),e=>e.code==='provider_cooldown'&&e.metadata.retryAfterSeconds>0);assert.equal(calls,1);
});


for(const backend of ['gemma','tts','asr'])for(const invalid of ['malformed','semantic'])test(`${backend} invalid paid 200 ${invalid} quarantines fresh factories through result validation`,async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;req.resume();res.setHeader('content-type',backend==='tts'?'audio/wav':'application/json');res.end(backend==='tts'?(invalid==='malformed'?Buffer.from('not WAV'):(()=>{const b=wav();b.fill(0,44);return b;})()):invalid==='malformed'?'{':'{}');});
 const {checksum}=await import('../packages/agent-runtime/adapters/audio.mjs'),{createSmartLabsAdapters}=await load();const bytes=wav();const deps={...seams,readControlledAudio:async()=>({bytes,mime:'audio/wav',sha256:checksum(bytes),versionId:sourceId,assetId:sourceId,jobId:sourceId})};
 const action=a=>backend==='gemma'?a.gemma.complete({messages:[{role:'user',content:'مرحبا'}]}):backend==='tts'?a.tts.synthesize({text:'مرحبا'}):a.asr.transcribe({sourceVersionId:sourceId});
 await assert.rejects(action(createSmartLabsAdapters(config(url),deps)),e=>e.metadata.indeterminate===true&&!JSON.stringify(e).includes('dummy-test-secret'));
 await assert.rejects(action(createSmartLabsAdapters(config(url),deps)),e=>e.code==='outcome_recovery_required');assert.equal(calls,1);
});
for(const backend of ['gemma','tts','asr'])test(`${backend} paid validated success and definitive 401 release; predispatch invalid input does not quarantine`,async t=>{
 let calls=0,reject=false;const url=await stub(t,(req,res)=>{calls++;req.resume();if(reject){res.writeHead(401);return res.end('private raw body');}res.setHeader('content-type',backend==='tts'?'audio/wav':'application/json');res.end(backend==='tts'?wav():JSON.stringify(backend==='gemma'?{model:'gemma4-26b-a4b-canary',choices:[{message:{role:'assistant',content:'مرحبا'},finish_reason:'stop'}]}:{text:'مرحبا',language:'ar',duration:.1,processing_time_ms:1}));});
 const {checksum}=await import('../packages/agent-runtime/adapters/audio.mjs'),{createSmartLabsAdapters}=await load();const bytes=wav(),deps={...seams,readControlledAudio:async()=>({bytes,mime:'audio/wav',sha256:checksum(bytes),versionId:sourceId,assetId:sourceId,jobId:sourceId})};
 const action=a=>backend==='gemma'?a.gemma.complete({messages:[{role:'user',content:'مرحبا'}]}):backend==='tts'?a.tts.synthesize({text:'مرحبا'}):a.asr.transcribe({sourceVersionId:sourceId});
 const invalid=createSmartLabsAdapters(config(url),deps);await assert.rejects(backend==='gemma'?invalid.gemma.complete({tools:[]}):backend==='tts'?invalid.tts.synthesize({text:''}):invalid.asr.transcribe({sourceVersionId:'invalid'}));assert.equal(calls,0);
 await action(createSmartLabsAdapters(config(url),deps));await action(createSmartLabsAdapters(config(url),deps));assert.equal(calls,2);
 reject=true;await assert.rejects(action(createSmartLabsAdapters(config(url),deps)),e=>e.code==='authentication_failed'&&e.metadata.indeterminate!==true);reject=false;await action(createSmartLabsAdapters(config(url),deps));assert.equal(calls,4);
});

const errorCodes={400:'request_rejected',401:'authentication_failed',402:'insufficient_credits',403:'account_forbidden',413:'input_too_large',422:'input_invalid',429:'provider_busy',503:'provider_unavailable',504:'provider_timeout'};
for(const backend of ['gemma','tts','asr'])for(const status of backend==='gemma'?[401,429,503,504]:backend==='tts'?[401,402,429,503,504]:[400,401,403,413,422,429,503,504])test(`${backend} status ${status}: sanitized proxy failure, one request, no automatic retry`,async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;req.resume();res.writeHead(status,{'content-type':'text/html','retry-after':status===429?'3':'','x-request-id':'safe-id'});res.end('<html>dummy-test-secret private raw body</html>');});const {checksum}=await import('../packages/agent-runtime/adapters/audio.mjs');const bytes=wav();
 const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),{...seams,readControlledAudio:async()=>({bytes,mime:'audio/wav',sha256:checksum(bytes),versionId:sourceId,assetId:sourceId,jobId:sourceId})});
 const action=backend==='gemma'?()=>a.gemma.complete({messages:[{role:'user',content:'مرحبا'}]}):backend==='tts'?()=>a.tts.synthesize({text:'مرحبا'}):()=>a.asr.transcribe({sourceVersionId:sourceId});
 await assert.rejects(action(),e=>{assert.equal(e.code,errorCodes[status]);assert.equal(e.status,status);assert.equal(e.metadata.requestId,'safe-id');if(status===429)assert.equal(e.metadata.retryAfterSeconds,3);assert.equal(JSON.stringify(e).includes('dummy-test-secret'),false);assert.equal(JSON.stringify(e).includes('private raw body'),false);return true;});assert.equal(calls,1);
});
test('Gemma rejects unsupported schemas, tool fields, >8192 exact tokens, output and byte budget before request',async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;res.end();});const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),seams);const good={messages:[{role:'user',content:'مرحبا'}]};
 for(const bad of [{...good,tools:[]},{...good,response_format:{}},{...good,stream:true},{...good,model:'other'},{...good,max_tokens:2049},{...good,temperature:NaN},{messages:[{role:'tool',content:'x'}]},{messages:[{role:'user',content:'x'.repeat(33000)}]}])await assert.rejects(a.gemma.complete(bad));
 await assert.rejects(createSmartLabsAdapters(config(url),{...seams,tokenCounter:()=>8193}).gemma.complete(good),e=>e.code==='input_token_budget');
 await assert.rejects(createSmartLabsAdapters(config(url),{...seams,thinkingDisabled:false}).gemma.complete(good),e=>e.code==='thinking_contract_required');assert.equal(calls,0);
});
for(const kind of ['malformed','oversize','usage','tool','wrong-model','invalid-id'])test(`Gemma bounded output rejects ${kind}`,async t=>{
 const url=await stub(t,(req,res)=>{req.resume();res.setHeader('content-type','application/json');if(kind==='malformed')return res.end('{');if(kind==='oversize')return res.end('x'.repeat(131073));const value={model:'gemma4-26b-a4b-canary',choices:[{message:{role:'assistant',content:'مرحبا'},finish_reason:'stop'}]};if(kind==='usage')value.usage={prompt_tokens:'1',completion_tokens:2,total_tokens:3};if(kind==='tool')value.choices[0].message.tool_calls=[];if(kind==='wrong-model')value.model='other';if(kind==='invalid-id')return res.end(JSON.stringify({data:[{id:['gemma4-26b-a4b-canary']}]}));res.end(JSON.stringify(value));});
 const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),seams);await assert.rejects(kind==='invalid-id'?a.gemma.models():a.gemma.complete({messages:[{role:'user',content:'مرحبا'}]}));
});
test('TTS Unicode boundary, stopped backend, cloning and voice overrides are pre-contact refusals',async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;req.resume();res.setHeader('content-type','audio/wav');res.end(wav());});const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),seams);
 await a.tts.synthesize({text:'م'.repeat(500)});assert.equal(calls,1);
 for(const input of [{text:'م'.repeat(501)},{text:'مرحبا',ref_audio:'x'},{text:'مرحبا',voice_id:'x'},{text:'مرحبا',tts_backend:'cosyvoice3'}])await assert.rejects(a.tts.synthesize(input));
 await assert.rejects(createSmartLabsAdapters({...config(url),ttsBackend:'cosyvoice3'},seams).tts.synthesize({text:'مرحبا'}),e=>e.code==='tts_configuration_invalid');assert.equal(calls,1);
});
for(const kind of ['empty','not-wave','stereo','sample-rate','bits','silent','truncated','oversize'])test(`TTS real WAV validation refuses ${kind}`,async t=>{
 let b=kind==='empty'?Buffer.alloc(0):kind==='not-wave'?Buffer.from('audio/wav'):kind==='stereo'?wav(.1,{channels:2}):kind==='sample-rate'?wav(.1,{rate:48000}):kind==='bits'?wav(.1,{bits:32}):kind==='silent'?wav(.1,{silent:true}):wav();if(kind==='truncated')b=b.subarray(0,b.length-1);if(kind==='oversize')b=Buffer.alloc(8*1024*1024+1);
 const url=await stub(t,(req,res)=>{req.resume();res.setHeader('content-type','audio/wav');res.end(b);});const {createSmartLabsAdapters}=await load();await assert.rejects(createSmartLabsAdapters(config(url),seams).tts.synthesize({text:'مرحبا'}));
});
for(const kind of ['20.1s','25MiB','checksum','webm','mime','foreign','extra-field'])test(`ASR controlled audio pre-upload denial ${kind}`,async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;res.end();});const {checksum}=await import('../packages/agent-runtime/adapters/audio.mjs');let bytes=kind==='20.1s'?wav(20.1):kind==='25MiB'?Buffer.alloc(25*1024*1024+1):kind==='webm'?Buffer.from([0x1a,0x45,0xdf,0xa3]):wav();
 const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),{...seams,readControlledAudio:async()=>kind==='foreign'?null:{bytes,mime:kind==='mime'?'audio/mpeg':'audio/wav',sha256:kind==='checksum'?'0'.repeat(64):checksum(bytes),versionId:sourceId,assetId:sourceId,jobId:sourceId}});
 await assert.rejects(a.asr.transcribe(kind==='extra-field'?{sourceVersionId:sourceId,language:'en'}:{sourceVersionId:sourceId}));assert.equal(calls,0);
});
for(const value of [{text:'مرحبا',language:'en',duration:1,processing_time_ms:1},{text:[],language:'ar',duration:1,processing_time_ms:1},{text:'مرحبا',language:'ar',duration:21,processing_time_ms:1},{text:'مرحبا',language:'ar',duration:1,processing_time_ms:-1},{text:'مرحبا',language:'ar',duration:1,processing_time_ms:1,request_id:['id']},'{'])test('ASR response shape rejects '+JSON.stringify(value),async t=>{
 const url=await stub(t,(req,res)=>{req.resume();res.setHeader('content-type','application/json');res.end(typeof value==='string'?value:JSON.stringify(value));});const {checksum}=await import('../packages/agent-runtime/adapters/audio.mjs');const bytes=wav();const {createSmartLabsAdapters}=await load();await assert.rejects(createSmartLabsAdapters(config(url),{...seams,readControlledAudio:async()=>({bytes,mime:'audio/wav',sha256:checksum(bytes),versionId:sourceId,assetId:sourceId,jobId:sourceId})}).asr.transcribe({sourceVersionId:sourceId}),e=>e.code==='response_invalid');
});
test('common native HTTP deadline covers stalled body; cancellation and rejected fetch never retry',async t=>{
 const {boundedHttp}=await import('../packages/agent-runtime/adapters/http.mjs');let calls=0;const url=await stub(t,(req,res)=>{calls++;req.resume();res.writeHead(200,{'content-type':'application/json'});res.write('{');});
 await assert.rejects(boundedHttp({url,key:'dummy-test-secret',header:'x-api-key',timeoutMs:30,ownedLoopbackTest:true}),e=>e.code==='deadline_exceeded'&&e.metadata.indeterminate);assert.equal(calls,1);
 const aborted=AbortSignal.abort();await assert.rejects(boundedHttp({url,key:'dummy-test-secret',header:'x-api-key',signal:aborted,ownedLoopbackTest:true}),e=>e.code==='cancelled');assert.equal(calls,1);
 const controller=new AbortController();setTimeout(()=>controller.abort(),30);await assert.rejects(boundedHttp({url,key:'dummy-test-secret',header:'x-api-key',signal:controller.signal,ownedLoopbackTest:true}),e=>e.code==='cancelled'&&e.metadata.indeterminate);assert.equal(calls,2);
 const closed=createServer();closed.listen(0,'127.0.0.1');await new Promise(r=>closed.once('listening',r));const port=closed.address().port;await new Promise(r=>closed.close(r));await assert.rejects(boundedHttp({url:`http://127.0.0.1:${port}`,key:'dummy-test-secret',header:'x-api-key',ownedLoopbackTest:true}),e=>e.code==='transport_indeterminate');
});


test('HTTP side-effect boundary denies non-owned insecure URLs and redacts error request IDs',async t=>{
 const {boundedHttp}=await import('../packages/agent-runtime/adapters/http.mjs');let calls=0;const url=await stub(t,(req,res)=>{calls++;res.writeHead(401,{'x-request-id':'dummy-test-secret'});res.end();});
 await assert.rejects(boundedHttp({url,key:'dummy-test-secret',header:'x-api-key'}),e=>e.code==='configuration_invalid');assert.equal(calls,0);
 await assert.rejects(boundedHttp({url,key:'dummy-test-secret',header:'x-api-key',ownedLoopbackTest:true}),e=>e.metadata.requestId===null&&!JSON.stringify(e).includes('dummy-test-secret'));assert.equal(calls,1);
});
for(const backend of ['gemma','tts','asr'])test(`${backend} actual stalled body deadline quarantines capacity across factories`,async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;req.resume();res.writeHead(200,{'content-type':backend==='tts'?'audio/wav':'application/json'});res.write('x');});const {checksum}=await import('../packages/agent-runtime/adapters/audio.mjs');const bytes=wav();const {createSmartLabsAdapters}=await load();const d={...seams,testDeadlineMs:40,readControlledAudio:async()=>({bytes,mime:'audio/wav',sha256:checksum(bytes),versionId:sourceId,assetId:sourceId,jobId:sourceId})};const a=createSmartLabsAdapters(config(url),d),b=createSmartLabsAdapters(config(url),d);
 const action=x=>{const options={signal:AbortSignal.timeout(300)};return backend==='gemma'?x.gemma.complete({messages:[{role:'user',content:'مرحبا'}]},options):backend==='tts'?x.tts.synthesize({text:'مرحبا'},options):x.asr.transcribe({sourceVersionId:sourceId},options);};
 await assert.rejects(action(a),e=>e.code==='deadline_exceeded'&&e.metadata.indeterminate&&e.metadata.latencyMs<1000);await assert.rejects(action(b),e=>e.code==='outcome_recovery_required');assert.equal(calls,1);
});


test('Gemma 60s operation budget includes trusted token counting; late counter cannot cause a dispatch',async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'gemma4-26b-a4b-canary',choices:[{message:{role:'assistant',content:'مرحبا'},finish_reason:'stop'}]}));});const {createSmartLabsAdapters}=await load();
 const a=createSmartLabsAdapters(config(url),{...seams,testDeadlineMs:40,tokenCounter:async()=>{await new Promise(r=>setTimeout(r,150));return 5;}});
 await assert.rejects(a.gemma.complete({messages:[{role:'user',content:'مرحبا'}]}),e=>e.code==='deadline_exceeded'&&e.metadata.indeterminate===false);assert.equal(calls,0);
 const b=createSmartLabsAdapters(config(url),{...seams,tokenCounter:()=>{throw new Error('dummy-test-secret');}});await assert.rejects(b.gemma.complete({messages:[{role:'user',content:'مرحبا'}]}),e=>e.code==='token_counter_failed'&&!e.message.includes('dummy-test-secret'));assert.equal(calls,0);
});


test('public provider-neutral adapter exports are usable without SmartLabs URLs or credentials',async()=>{
 const m=await import('../packages/agent-runtime/adapters/index.mjs');for(const name of ['GemmaAdapter','TtsAdapter','AsrAdapter'])assert.equal(typeof m[name],'function');
 const a=new m.GemmaAdapter({model:'neutral-model',tokenCounter:()=>5,thinkingDisabled:true,transport:async()=>({contentType:'application/json',bytes:Buffer.from(JSON.stringify({model:'neutral-model',choices:[{message:{role:'assistant',content:'مرحبا'},finish_reason:'stop'}]})),metadata:{status:200,requestId:null,latencyMs:0}})});assert.equal((await a.complete({messages:[{role:'user',content:'مرحبا'}]})).text,'مرحبا');
});


test('JSON-escaped credential echoes cannot reach returned text',async t=>{
 const secret='dummy-test-secret',encoded=[...secret].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
 const url=await stub(t,(req,res)=>{req.resume();res.setHeader('content-type','application/json');res.end(`{"model":"gemma4-26b-a4b-canary","choices":[{"message":{"role":"assistant","content":"${encoded}"},"finish_reason":"stop"}]}`);});const {createSmartLabsAdapters}=await load();await assert.rejects(createSmartLabsAdapters(config(url),seams).gemma.complete({messages:[{role:'user',content:'مرحبا'}]}),e=>e.code==='response_secret_rejected');
});
test('Retry-After delta larger than one day is preserved, and HTTP date parses safely',async t=>{
 const {boundedHttp}=await import('../packages/agent-runtime/adapters/http.mjs');let header='172800';const url=await stub(t,(req,res)=>{res.writeHead(429,{'retry-after':header});res.end();});
 await assert.rejects(boundedHttp({url,key:'dummy-test-secret',header:'x-api-key',ownedLoopbackTest:true}),e=>e.metadata.retryAfterSeconds===172800);
 header=new Date(Date.now()+5000).toUTCString();await assert.rejects(boundedHttp({url,key:'dummy-test-secret',header:'x-api-key',ownedLoopbackTest:true}),e=>e.metadata.retryAfterSeconds>=3&&e.metadata.retryAfterSeconds<=5);
});


test('uncontracted 202 is not accepted as a completed Gemma response',async t=>{
 const url=await stub(t,(req,res)=>{req.resume();res.writeHead(202,{'content-type':'application/json'});res.end(JSON.stringify({model:'gemma4-26b-a4b-canary',choices:[{message:{role:'assistant',content:'مرحبا'},finish_reason:'stop'}]}));});const {createSmartLabsAdapters}=await load();await assert.rejects(createSmartLabsAdapters(config(url),seams).gemma.complete({messages:[{role:'user',content:'مرحبا'}]}),e=>e.code==='response_status_invalid'&&e.metadata.status===202&&e.metadata.indeterminate);
});


test('TTS billing metadata is numeric-only through an explicit trusted header mapper; unknown names are never guessed',async t=>{
 const url=await stub(t,(req,res)=>{req.resume();res.writeHead(200,{'content-type':'audio/wav','x-fixture-credits':'1.25','x-fixture-balance':'9'});res.end(wav());});const {createSmartLabsAdapters}=await load();
 const readBilling=h=>({creditsUsed:Number(h.get('x-fixture-credits')),balance:Number(h.get('x-fixture-balance'))});
 const out=await createSmartLabsAdapters(config(url),{...seams,readBilling}).tts.synthesize({text:'مرحبا'});assert.deepEqual(out.metadata.billing,{creditsUsed:1.25,balance:9});
 const bad=await createSmartLabsAdapters(config(url),{...seams,readBilling:()=>({creditsUsed:'dummy-test-secret',rawHeaders:'dummy-test-secret'})}).tts.synthesize({text:'مرحبا'});assert.equal(bad.metadata.billing,null);assert.equal(JSON.stringify(bad.metadata).includes('dummy-test-secret'),false);
});


test('upstream 504 is indeterminate: a second factory cannot blindly dispatch after a proxy timeout',async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;res.writeHead(504);res.end('fixture gateway timeout');});const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),seams);await assert.rejects(a.gemma.models(),e=>e.code==='provider_timeout'&&e.metadata.indeterminate);await assert.rejects(createSmartLabsAdapters(config(url),seams).gemma.models(),e=>e.code==='outcome_recovery_required');assert.equal(calls,1);
});


test('credential whitespace is rejected rather than silently repaired by Headers',async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;req.resume();res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'gemma4-26b-a4b-canary'}]}));});const {createSmartLabsAdapters}=await load();await assert.rejects(createSmartLabsAdapters({...config(url),gemmaKey:' dummy-test-secret '},seams).gemma.models(),e=>e.code==='credentials_missing');assert.equal(calls,0);
});

function wav(seconds=0.1,{rate=24000,channels=1,bits=16,silent=false}={}){
 const samples=Math.round(seconds*rate),data=samples*channels*(bits/8),b=Buffer.alloc(44+data);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*channels*bits/8,28);b.writeUInt16LE(channels*bits/8,32);b.writeUInt16LE(bits,34);b.write('data',36);b.writeUInt32LE(data,40);if(data&&!silent)b.writeInt16LE(42,44);return b;
}
test('TTS tracer: exact OmniVoice wire body and validated private-ready WAV',async t=>{
 let calls=0;const bytes=wav();const url=await stub(t,async(req,res)=>{calls++;assert.equal(req.url,'/text-to-speech');assert.equal(req.headers['x-api-key'],'dummy-test-secret');let body='';for await(const c of req)body+=c;assert.deepEqual(JSON.parse(body),{text:'مرحبا بالعالم',tts_backend:'omnivoice',voice_id:'smarttts2-xms-default',dialect_id:'ar-SA'});res.setHeader('content-type','audio/wav');res.end(bytes);});
 const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),seams);assert.equal(typeof a.tts?.synthesize,'function');
 const out=await a.tts.synthesize({text:'مرحبا بالعالم'});assert.deepEqual(out.bytes,bytes);assert.equal(out.mime,'audio/wav');assert.equal(out.sample_rate,24000);assert.equal(out.channels,1);assert.equal(out.duration,0.1);assert.match(out.sha256,/^[a-f0-9]{64}$/);assert.equal(out.backend,'omnivoice');assert.equal(calls,1);
});

test('Gemma tracer: one actual chat request, bounded plain response, safe metadata',async t=>{
 let calls=0;
 const url=await stub(t,async(req,res)=>{calls++; assert.equal(req.url,'/chat/completions');assert.equal(req.headers.authorization,'Bearer dummy-test-secret');
 let body='';for await(const c of req)body+=c;const p=JSON.parse(body);assert.deepEqual(p,{model:'gemma4-26b-a4b-canary',messages:[{role:'user',content:'مرحبا'}],temperature:0.3,max_tokens:2048,stream:false});
 res.setHeader('content-type','application/json');res.setHeader('x-request-id','safe-id');res.end(JSON.stringify({model:p.model,choices:[{message:{role:'assistant',content:'أهلاً'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}}));});
 const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),seams);
 const out=await a.gemma.complete({messages:[{role:'user',content:'مرحبا'}]});
 assert.equal(out.text,'أهلاً');assert.equal(out.metadata.requestId,'safe-id');assert.equal(out.metadata.model,'gemma4-26b-a4b-canary');assert.equal(calls,1);
 assert.ok(out.metadata.latencyMs>=0);assert.equal(JSON.stringify(out.metadata).includes('مرحبا'),false);
});
test('default OFF, missing credentials and exact counter deny before I/O',async t=>{
 let calls=0;const url=await stub(t,(req,res)=>{calls++;res.end();});const {createSmartLabsAdapters}=await load();
 const c=config(url);delete c.gemmaEnabled;const off=createSmartLabsAdapters(c,seams);
 await assert.rejects(off.gemma.models(),e=>e.code==='adapter_disabled');
 await assert.rejects(createSmartLabsAdapters({...config(url),gemmaKey:''},seams).gemma.models(),e=>e.code==='credentials_missing');
 await assert.rejects(createSmartLabsAdapters(config(url),{...seams,tokenCounter:undefined}).gemma.complete({messages:[{role:'user',content:'مرحبا'}]}),e=>e.code==='exact_token_counter_required');
 assert.equal(calls,0);
});
test('shared process admission across instances holds through body; failure releases only determinate outcomes',async t=>{
 let calls=0,finish,started;const ready=new Promise(r=>started=r);
 const url=await stub(t,(req,res)=>{calls++;if(calls>1){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'gemma4-26b-a4b-canary'}]}));return;}res.writeHead(200,{'content-type':'application/json'});res.write('{');finish=()=>res.end('"data":[{"id":"gemma4-26b-a4b-canary"}]}');started();});
 const {createSmartLabsAdapters}=await load();const a=createSmartLabsAdapters(config(url),seams),b=createSmartLabsAdapters(config(url),seams);
 const p=a.gemma.models();await ready;await assert.rejects(b.gemma.models(),e=>e.status===429&&e.code==='local_busy');assert.equal(calls,1);finish();await p;
 const q=b.gemma.models();await new Promise(r=>setTimeout(r,30));finish();await q;assert.equal(calls,2);
});
