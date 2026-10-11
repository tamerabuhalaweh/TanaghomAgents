// Offline RC1/RC2 regressions. No external HTTP or providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {classifyIp,downloadArtifact} from '../packages/creative-runtime/adapters/http-image.mjs';
import {validateMp4} from '../packages/creative-runtime/render/mp4.mjs';
const origin='https://artifact.example';
const unsafe=['3000::1','2d00::1','2001:1000::1','3ffe::1','5f00::1','fc01::1','FC01:0000:0000:0000:0000:0000:0000:0001','fdff:ffff::1','fe90::1','febf:ffff::1','fec1::1','feff::1','::ffff:7f00:1','0:0:0:0:0:ffff:127.0.0.1','::FFFF:0A00:0001','::ffff:172.16.0.1','::ffff:c0a8:101','::ffff:a9fe:a9fe','2001:2::1','2001:0002:0:0:0:0:0:1','100::1','2001:db8::1','3fff::1','2002:7f00:1::1','::127.0.0.1','64:ff9b::7f00:1','64:ff9b::10.0.0.1','64:ff9b:1::1','ff02::1','::','0:0:0:0:0:0:0:1','2606:4700::1%1','bogus:address','::ffff:999.0.0.1','1::2::3'];
for(const address of unsafe)test('RC1 non-public/invalid binary destination '+address,async()=>{
 assert.notEqual(classifyIp(address),'public');
 for(const answers of [[address],['8.8.8.8',address],[address,'2606:4700:4700::1111']]){
  let requests=0;
  await assert.rejects(()=>downloadArtifact({url:origin+'/x',exactOrigins:[origin],resolveHost:async()=>answers,pinnedRequest:async()=>{requests++;return new Response('fixture');}}),e=>e.errorClass==='deterministic');
  assert.equal(requests,0);
 }
});
for(const address of ['8.8.8.8','2410::1','2630::1','2606:4700:4700::1111','2001:4860:4860:0:0:0:0:8888','::ffff:808:808','0:0:0:0:0:ffff:8.8.8.8','64:ff9b::808:808'])test('RC1 public normalized positive pin '+address,async()=>{
 assert.equal(classifyIp(address),'public');let requests=0;
 assert.equal((await downloadArtifact({url:origin+'/x',exactOrigins:[origin],resolveHost:async()=>[address],pinnedRequest:async p=>{requests++;assert.equal(p.address,address);return new Response('fixture');}})).bytes.toString(),'fixture');assert.equal(requests,1);
});
test('RC1 actual default HTTPS transport makes zero owned-localhost connections with test bypass OFF',async()=>{
 let connections=0,bytes=0;const server=createServer(socket=>{connections++;socket.on('data',b=>{bytes+=b.length;socket.destroy();});socket.on('error',()=>{});});
 server.listen(0,'127.0.0.1');await once(server,'listening');const approved=`https://artifact.example:${server.address().port}`;
 try{for(const address of ['::ffff:7f00:1','0:0:0:0:0:ffff:127.0.0.1','127.0.0.1'])await assert.rejects(()=>downloadArtifact({url:approved+'/x',exactOrigins:[approved],resolveHost:async()=>[address],testLoopback:false,timeoutMs:1000}),e=>e.errorClass==='deterministic');}
 finally{server.close();await once(server,'close');}
 assert.equal(connections,0);assert.equal(bytes,0);
});
const fixture=readFileSync(new URL('../evaluation/creative-talking-head-v1/fixtures/encoded.mp4',import.meta.url));
const opts={expectedDurationSec:5,allowedCodecs:['avc1'],requireAudio:true};
function boxes(b,s=0,e=b.length){const out=[];for(let p=s;p<e;){const size=b.readUInt32BE(p);assert.ok(size>=8&&p+size<=e);out.push({type:b.toString('latin1',p+4,p+8),start:p,end:p+size});p+=size;}return out;}
function find(b,type,s=0,e=b.length){for(const box of boxes(b,s,e)){if(box.type===type)return box;if(['moov','trak','mdia','minf','stbl'].includes(box.type)){const found=find(b,type,box.start+8,box.end);if(found)return found;}}}
// Duplicate the actual entry and relocate all media offsets after insertion.
// The fast-start fixture has moov BEFORE mdat; retain every payload byte.
function addEntry(b,audio=false){const moov=boxes(b).find(x=>x.type==='moov');const track=boxes(b,moov.start+8,moov.end).filter(x=>x.type==='trak')[audio?1:0];const parents=[moov,track];for(const type of ['mdia','minf','stbl','stsd'])parents.push(find(b,type,parents.at(-1).start+8,parents.at(-1).end));const stsd=parents.at(-1),entry=boxes(b,stsd.start+16,stsd.end)[0],copy=Buffer.from(b.subarray(entry.start,entry.end));const out=Buffer.concat([b.subarray(0,stsd.end),copy,b.subarray(stsd.end)]);for(const parent of parents)out.writeUInt32BE(parent.end-parent.start+copy.length,parent.start);out.writeUInt32BE(2,stsd.start+12);
 function relocate(s=0,e=out.length){for(const box of boxes(out,s,e)){if(box.type==='stco')for(let i=0;i<out.readUInt32BE(box.start+12);i++){const p=box.start+16+i*4,v=out.readUInt32BE(p);if(v>=stsd.end)out.writeUInt32BE(v+copy.length,p);}if(['moov','trak','mdia','minf','stbl'].includes(box.type))relocate(box.start+8,box.end);}}
 relocate();const originalMedia=boxes(b).find(x=>x.type==='mdat'),newMedia=boxes(out).find(x=>x.type==='mdat');assert.deepEqual(out.subarray(newMedia.start,newMedia.end),b.subarray(originalMedia.start,originalMedia.end));return {bytes:out,second:stsd.end};}
function setMap(b,index,audio=false){const moov=boxes(b).find(x=>x.type==='moov'),track=boxes(b,moov.start+8,moov.end).filter(x=>x.type==='trak')[audio?1:0],stsc=find(b,'stsc',track.start+8,track.end);for(let i=0;i<b.readUInt32BE(stsc.start+12);i++)b.writeUInt32BE(index,stsc.start+24+i*12);}
test('RC2 no additional active video track may hide an unsupported description',()=>{const b=Buffer.from(fixture),moov=boxes(b).find(x=>x.type==='moov'),track=boxes(b,moov.start+8,moov.end).filter(x=>x.type==='trak')[1],hdlr=find(b,'hdlr',track.start+8,track.end);b.write('vide',hdlr.start+16,'latin1');assert.throws(()=>validateMp4(b,{...opts,requireAudio:false}),/mp4_/);});
test('RC2 unmodified provider-encoded H264 AAC facts preserved',()=>{const m=validateMp4(fixture,opts);assert.equal(m.bytes,52247);assert.equal(m.codec,'avc1');assert.equal(m.width,360);assert.equal(m.height,640);assert.equal(m.durationSec,5);assert.deepEqual(m.audio,{codec:'mp4a',channels:1,sampleRate:48000,metadata_source:'container_sample_entry'});});
for(const mutation of ['declared-missing','undeclared-extra','zero-count','zero-index','missing-index','truncated-entry','oversized-entry','undersized-entry','trailing-entry-byte','unsupported-active','allowed-but-mismatched-active','mismatched-visual','audio-declared-missing','audio-missing-index','audio-unsupported','audio-mismatched'])test('RC2 rejects sample description '+mutation,()=>{
 let b=Buffer.from(fixture),stsd=find(b,'stsd');
 if(mutation==='declared-missing'){b.writeUInt32BE(2,stsd.start+12);setMap(b,2);}
 if(mutation==='zero-count')b.writeUInt32BE(0,stsd.start+12);
 if(mutation==='zero-index')setMap(b,0);
 if(mutation==='missing-index')setMap(b,2);
 if(mutation==='truncated-entry')b.writeUInt32BE(stsd.end-stsd.start,stsd.start+16);
 if(mutation==='oversized-entry')b.writeUInt32BE(0xffffffff,stsd.start+16);
 if(mutation==='undersized-entry')b.writeUInt32BE(8,stsd.start+16);
 if(mutation==='trailing-entry-byte')b.writeUInt32BE(stsd.end-stsd.start-17,stsd.start+16);
 if(['undeclared-extra','unsupported-active','allowed-but-mismatched-active','mismatched-visual'].includes(mutation)){const x=addEntry(b);b=x.bytes;setMap(b,2);if(mutation==='undeclared-extra')b.writeUInt32BE(1,find(b,'stsd').start+12);if(mutation==='unsupported-active')b.write('zzzz',x.second+4,'latin1');if(mutation==='allowed-but-mismatched-active')b.write('mp4v',x.second+4,'latin1');if(mutation==='mismatched-visual')b.writeUInt16BE(361,x.second+32);}
 if(mutation.startsWith('audio-')){const x=addEntry(b,true);b=x.bytes;setMap(b,2,true);if(mutation==='audio-declared-missing'){const moov=boxes(b).find(v=>v.type==='moov'),track=boxes(b,moov.start+8,moov.end).filter(v=>v.type==='trak')[1];b.writeUInt32BE(3,find(b,'stsd',track.start+8,track.end).start+12);}if(mutation==='audio-missing-index')setMap(b,3,true);if(mutation==='audio-unsupported')b.write('zzzz',x.second+4,'latin1');if(mutation==='audio-mismatched')b.writeUInt16BE(2,x.second+24);}
 assert.throws(()=>validateMp4(b,{...opts,allowedCodecs:['avc1','mp4v']}),/mp4_/);
});
for(const audio of [false,true])test('RC2 real existing second consistent '+(audio?'audio':'video')+' description is valid',()=>{const {bytes:b}=addEntry(fixture,audio);setMap(b,2,audio);const m=validateMp4(b,opts);assert.equal(m.codec,'avc1');assert.equal(m.audio.codec,'mp4a');});
