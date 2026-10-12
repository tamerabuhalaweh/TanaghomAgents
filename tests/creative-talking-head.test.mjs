import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
test('live runner refuses source-only even with feature flags ON; before DB/key/network',()=>{const r=spawnSync(process.execPath,['scripts/creative-presenter-worker.mjs','--operation=talking_head'],{env:{PATH:process.env.PATH,TALKING_HEAD_ENABLED:'true',LIP_SYNC_ENABLED:'true',CUSTOM_AVATAR_ENABLED:'true'},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/provider_execution_not_authorized/);});
import {validateMp4} from '../packages/creative-runtime/render/mp4.mjs';
import {validateWave,validateMpegAudio} from '../packages/creative-runtime/render/presenter-worker.mjs';
test('bounded actual MP3 layer III byte frames expose duration/rate/channels; forged audio rejected',()=>{const meta=validateMpegAudio(readFileSync(new URL('encoded.mp3',scratch)));assert.ok(Math.abs(meta.durationSec-5)<.25);assert.equal(meta.sampleRate,48000);assert.equal(meta.channels,1);assert.throws(()=>validateMpegAudio(Buffer.from('MP3 fake')),/audio_mp3_invalid/);});
const scratch=new URL('../evaluation/creative-talking-head-v1/fixtures/',import.meta.url);
test('binary signatures reject high-bit aliases rather than lossy ASCII matches',()=>{const wav=readFileSync(new URL('encoded.wav',scratch));for(const tag of ['RIFF','WAVE','fmt ','data'])for(let i=0;i<4;i++){const b=Buffer.from(wav);b[b.indexOf(tag)+i]|=128;assert.throws(()=>validateWave(b),/audio_wave/);}const mp4=readFileSync(new URL('encoded.mp4',scratch));for(const tag of ['ftyp','isom','vide','soun','avc1','mp4a'])for(let i=0;i<4;i++){const b=Buffer.from(mp4),offset=b.indexOf(tag);assert.ok(offset>=0,tag);b[offset+i]|=128;assert.throws(()=>validateMp4(b,{requireAudio:true,allowedCodecs:['avc1']}),/mp4_/);}});
test('controlled encoded media rejects container, codec, dimensions, duration and bounds',()=>{const b=readFileSync(new URL('encoded.mp4',scratch));for(const options of [{width:361},{height:641},{expectedDurationSec:30},{allowedCodecs:['zzzz']}])assert.throws(()=>validateMp4(b,options),/mp4_/);assert.throws(()=>validateMpegAudio(Buffer.alloc(52428801)),/audio_mp3_invalid/);const w=readFileSync(new URL('encoded.wav',scratch));w.writeUInt16LE(3,w.indexOf('fmt ')+8);assert.throws(()=>validateWave(w),/audio_wave_format/);});
test('actual encoded MP4 reports AAC audio channels and rate; WAV byte parser rejects forged bytes',()=>{
 const checked=validateMp4(readFileSync(new URL('encoded.mp4',scratch)),{expectedDurationSec:5,allowedCodecs:['avc1'],requireAudio:true});
 assert.equal(checked.audio.codec,'mp4a');assert.equal(checked.audio.channels,1);assert.equal(checked.audio.sampleRate,48000);
 assert.equal(validateWave(readFileSync(new URL('encoded.wav',scratch))).durationSec,5);
 assert.throws(()=>validateWave(Buffer.from('RIFF fake')),/audio_wave_invalid/);
});

test('provider JSON responses bounded before parsing; malformed/oversized results remain indeterminate',async()=>{for(const [factory,key] of [[(await import('../packages/creative-runtime/adapters/heygen.mjs')).createHeyGenAdapter,'heygen'],[(await import('../packages/creative-runtime/adapters/sync.mjs')).createSyncAdapter,'sync']]){for(const bytes of ['not-json',JSON.stringify({data:{status:'completed',video_url:'https://artifact.example/x.mp4'},status:'COMPLETED',outputUrl:'https://artifact.example/x.mp4',pad:' '.repeat(1048577)})]){const p=factory({apiKey:'fixture-only',fetchImpl:async()=>new Response(bytes)});await assert.rejects(()=>p.queryTask('fixture'),e=>e.errorClass==='indeterminate',key);}}});
test('MP4 validator rejects trailing truncated box bytes',()=>{const bytes=readFileSync(new URL('encoded.mp4',scratch));assert.throws(()=>validateMp4(Buffer.concat([bytes,Buffer.from('junk')]),{expectedDurationSec:5,allowedCodecs:['avc1'],requireAudio:true}),/mp4_truncated/);});
test('presenter output must include a supported audio track',()=>{const bytes=readFileSync(new URL('encoded.mp4',scratch));bytes.write('zzzz',bytes.indexOf('soun'),'ascii');assert.throws(()=>validateMp4(bytes,{expectedDurationSec:5,allowedCodecs:['avc1'],requireAudio:true}),/mp4_audio/);});
test('lip_sync is canonical Creative Runtime and JSON contract capability, not a provider identifier',async()=>{const {isCapability}=await import('../packages/creative-runtime/capabilities.mjs');assert.equal(isCapability('lip_sync'),true);assert.equal(isCapability('lipsync-2'),false);for(const name of ['adapter-envelope','asset-metadata','create-job-request','job-record']){const schema=JSON.parse(readFileSync(new URL('../packages/contracts/schemas/creative/'+name+'.v1.schema.json',import.meta.url),'utf8'));assert.ok(schema.properties.capability.enum.includes('lip_sync'));}});
import test from 'node:test';
import assert from 'node:assert/strict';

test('HeyGen stock Arabic scripts use v3 look+explicit approved voice, not group or cloning', async () => {
 const { createHeyGenAdapter } = await import('../packages/creative-runtime/adapters/heygen.mjs');
 const calls=[];
 const provider=createHeyGenAdapter({apiKey:'fixture-only',fetchImpl:async(url,options)=>{
  calls.push({url,options});return new Response(JSON.stringify(options.method==='POST'?{data:{video_id:'fixture-video'}}:{data:{status:'completed',video_url:'https://artifact.example/result.mp4',duration:5}}));
 }});
 assert.equal((await provider.createTalkingHead({script:'مرحباً! 2026 Hello.',locale:'ar',ratio:'9:16',providerAvatarId:'look-approved',voiceId:'voice-approved',idempotencyKey:'fixture-job'})).taskId,'fixture-video');
 const body=JSON.parse(calls[0].options.body);
 assert.equal(calls[0].url,'https://api.heygen.com/v3/videos');
 assert.deepEqual(body.engine,{type:'avatar_iv'});assert.equal(body.avatar_id,'look-approved');assert.equal(body.voice_id,'voice-approved');assert.equal(body.output_format,'mp4');
 const result=await provider.queryTask('fixture-video');assert.equal(result.status,'succeeded');assert.equal(result.actualCostUsd,null);
 assert.equal(provider.cancelTask,undefined);
 const rate=createHeyGenAdapter({apiKey:'fixture',fetchImpl:async()=>new Response('{}',{status:429})});
 await assert.rejects(()=>rate.queryTask('fixture'),e=>e.errorClass==='capacity');
 await assert.rejects(()=>provider.createTalkingHead({script:'x',voiceId:'',providerAvatarId:'look'}),/invalid/);
});
test('Sync uses approved byte multipart video+audio, lipsync-2 and persisted key; image/text denied', async()=>{
 const {createSyncAdapter}=await import('../packages/creative-runtime/adapters/sync.mjs');
 const hits=[];const provider=createSyncAdapter({apiKey:'fixture',fetchImpl:async(url,options)=>{hits.push({url,options});return new Response(JSON.stringify(options.method==='POST'?{id:'generation-1'}:{status:'COMPLETED',outputUrl:'https://artifact.example/x.mp4',outputDuration:5}));}});
 await provider.createLipSync({video:{bytes:Buffer.from('fixture'),mime:'video/mp4'},audio:{bytes:Buffer.from('fixture'),mime:'audio/wav'},idempotencyKey:'job-1'});
 assert.equal(hits[0].url,'https://api.sync.so/v2/generate');assert.equal(hits[0].options.headers['Idempotency-Key'],'job-1');
 assert.equal(hits[0].options.body.get('model'),'lipsync-2');assert.equal(hits[0].options.body.get('input'),null);
 assert.equal(hits[0].options.body.get('audio').type,'audio/wav');
 assert.equal((await provider.queryTask('generation-1')).actualCostUsd,null);
 await assert.rejects(()=>provider.createLipSync({image:{},script:'x'}),/invalid/);assert.equal(provider.cancelTask,undefined);
});
