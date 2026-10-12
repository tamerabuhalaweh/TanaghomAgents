// Offline review regressions: actual downloader, no loopback bypass or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {downloadArtifact} from '../packages/creative-runtime/adapters/http-image.mjs';
import {validateMp4} from '../packages/creative-runtime/render/mp4.mjs';
const origin='https://artifact.example';
const fixture=readFileSync(new URL('../evaluation/creative-talking-head-v1/fixtures/encoded.mp4',import.meta.url));
const options={expectedDurationSec:5,allowedCodecs:['avc1'],requireAudio:true};
test('R1 actual runner hands approved configuration to downloader without network or loopback',async()=>{
 const source=readFileSync(new URL('../scripts/creative-presenter-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'');
 let downloads=0;
 const factory=config=>({artifactOrigins:config.artifactOrigins,testLoopback:false});
 await runInNewContext('(async()=>{'+source+'})()',{
  process:{env:{CREATIVE_PROVIDER_EXECUTION_AUTHORIZED:'true',TALKING_HEAD_ENABLED:'true',DATABASE_URL:'fixture-only',CREATIVE_UPLOAD_DIR:'fixture-only',CREATIVE_PRESENTER_ARTIFACT_ORIGINS:JSON.stringify([origin])},argv:['node','runner','--operation=talking_head'],pid:1},
  URL,console:{log:()=>{}},pg:{Client:class{async connect(){}async end(){}async query(){}}},createHeyGenAdapter:factory,createSyncAdapter:factory,createLocalFsStorage:()=>({}),claimPresenterJob:async()=>({job_id:'fixture-only'}),
  downloadArtifact:params=>downloadArtifact({...params,resolveHost:async()=>['8.8.8.8'],pinnedRequest:async()=>{downloads++;return new Response('fixture');}}),
  executePresenterJob:async({provider,download})=>{const params={url:origin+'/x',allowedOrigins:provider.artifactOrigins,testLoopback:provider.testLoopback};assert.equal((await download(params)).bytes.toString(),'fixture');await assert.rejects(()=>download({...params,url:'https://sub.artifact.example/x'}));return {};}
 });
 assert.equal(downloads,1);
});
function boxes(b,start=0,end=b.length){const out=[];for(let p=start;p<end;){const size=b.readUInt32BE(p);assert.ok(size>=8);out.push({type:b.toString('latin1',p+4,p+8),start:p,end:p+size});p+=size;}return out;}
function descendants(b,type,start=0,end=b.length){for(const box of boxes(b,start,end)){if(box.type===type)return box;if(['moov','trak','mdia','minf','stbl'].includes(box.type)){const found=descendants(b,type,box.start+8,box.end);if(found)return found;}}}
test('R1 runner HTTPS origin handoff reaches reused public pinned downloader offline',async()=>{
 let requests=0;const config={allowedOrigins:[origin],exactOrigins:[origin],resolveHost:async()=>['8.8.8.8'],pinnedRequest:async({url,address})=>{requests++;assert.equal(new URL(url).origin,origin);assert.equal(address,'8.8.8.8');return new Response('fixture');}};
 assert.equal((await downloadArtifact({url:origin+'/output.mp4',...config})).bytes.toString(),'fixture');assert.equal(requests,1);
});
test('R1 exact origins reject subdomain, other port, HTTP, credentials and redirect before transport',async()=>{
 for(const url of ['https://sub.artifact.example/x','https://artifact.example:444/x','http://artifact.example/x','https://user@artifact.example/x','https://evil.example/x']){let hits=0;await assert.rejects(()=>downloadArtifact({url,allowedOrigins:[origin],exactOrigins:[origin],resolveHost:async()=>['8.8.8.8'],pinnedRequest:async()=>{hits++;return new Response('fixture');}}));assert.equal(hits,0);}
 for(const location of ['https://sub.artifact.example/x','https://artifact.example:444/x','http://artifact.example/x']){let hits=0;await assert.rejects(()=>downloadArtifact({url:origin+'/redirect',allowedOrigins:[origin],exactOrigins:[origin],resolveHost:async()=>['8.8.8.8'],pinnedRequest:async()=>{hits++;return new Response(null,{status:302,headers:{location}});}}));assert.equal(hits,1);}
});
test('R2 actual presenter fixture has media payload and sample extents',()=>assert.equal(validateMp4(fixture,options).audio.codec,'mp4a'));
test('R1 exact origin downloader denies empty approvals and non-public/mixed A/AAAA before transport',async()=>{
 for(const approvals of [null,[]]){let hits=0;await assert.rejects(()=>downloadArtifact({url:origin+'/x',exactOrigins:approvals,resolveHost:async()=>['8.8.8.8'],pinnedRequest:async()=>{hits++;return new Response('fixture');}}));assert.equal(hits,0);}
 for(const answers of [['127.0.0.1'],['10.0.0.1'],['169.254.169.254'],['169.254.1.1'],['::1'],['fe80::1'],['fd00::1'],['8.8.8.8','10.0.0.1'],['2606:4700:4700::1111','fe80::1']]){let hits=0;await assert.rejects(()=>downloadArtifact({url:origin+'/x',exactOrigins:[origin],resolveHost:async()=>answers,pinnedRequest:async()=>{hits++;return new Response('fixture');}}));assert.equal(hits,0);}
});
test('R1 allowed HTTPS redirect re-resolves all answers and refuses mixed destination',async()=>{
 let hits=0;const resolved=[];await assert.rejects(()=>downloadArtifact({url:origin+'/x',exactOrigins:[origin,'https://second.example'],resolveHost:async host=>{resolved.push(host);return host==='artifact.example'?['8.8.8.8','2606:4700:4700::1111']:['8.8.8.8','169.254.169.254'];},pinnedRequest:async({address,maxBytes})=>{hits++;assert.equal(address,'8.8.8.8');assert.equal(maxBytes,10);return new Response(null,{status:302,headers:{location:'https://second.example/x'}});},maxBytes:10}));assert.deepEqual(resolved,['artifact.example','second.example']);assert.equal(hits,1);
});
test('R1 bounded artifact bytes reject oversize response on exact origin',async()=>{
 await assert.rejects(()=>downloadArtifact({url:origin+'/x',exactOrigins:[origin],resolveHost:async()=>['8.8.8.8'],pinnedRequest:async()=>new Response('12345'),maxBytes:4}),/byte size out of bounds/);
});
test('R2 empty malformed truncated and missing track sample tables fail closed',()=>{
 for(const b of [Buffer.alloc(0),Buffer.from('metadata only'),fixture.subarray(0,fixture.length-1)])assert.throws(()=>validateMp4(b,options),/mp4_/);
 const b=Buffer.from(fixture);b.write('junk',descendants(b,'stsz').start+4,'latin1');assert.throws(()=>validateMp4(b,options),/mp4_invalid_sample_extents/);
});
for(const mutation of ['no-mdat','empty-mdat','dummy-mdat','bad-chunk-offset','bad-sample-size','bad-chunk-map','out-of-bounds-audio'])test('R2 rejects '+mutation+' of real encoded fixture',()=>{
 let b=Buffer.from(fixture);const mdat=boxes(b).find(x=>x.type==='mdat');
 if(mutation==='no-mdat')b=Buffer.concat([b.subarray(0,mdat.start),b.subarray(mdat.end)]);
 if(['empty-mdat','dummy-mdat'].includes(mutation)){const tiny=Buffer.alloc(mutation==='empty-mdat'?8:9);tiny.writeUInt32BE(tiny.length);tiny.write('mdat',4);b=Buffer.concat([b.subarray(0,mdat.start),tiny,b.subarray(mdat.end)]);}
 if(mutation==='bad-chunk-offset')b.writeUInt32BE(0,descendants(b,'stco').start+16);
 if(mutation==='bad-sample-size')b.writeUInt32BE(b.length,descendants(b,'stsz').start+20);
 if(mutation==='bad-chunk-map')b.writeUInt32BE(0,descendants(b,'stsc').start+20);
 if(mutation==='out-of-bounds-audio'){const moov=boxes(b).find(x=>x.type==='moov');const tracks=boxes(b,moov.start+8,moov.end).filter(x=>x.type==='trak');const audio=tracks.find(t=>b.subarray(t.start,t.end).includes(Buffer.from('soun')));b.writeUInt32BE(b.length+1,descendants(b,'stco',audio.start+8,audio.end).start+16);}
 assert.throws(()=>validateMp4(b,options),/mp4_/);
});
