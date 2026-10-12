// Trusted deployment-injected absolute executable + immutable digest only.
// Forced demuxers, pipe-only protocols, decoded-output and wall-clock limits.
// Not an OS sandbox: deployment must sandbox untrusted codecs separately.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {checksum} from './audio.mjs';
import {fail,AdapterError} from './http.mjs';
function format(bytes){
 if(bytes.subarray(0,4).equals(Buffer.from('fLaC')))return ['flac','audio/flac'];
 if(bytes.subarray(0,4).equals(Buffer.from('OggS')))return ['ogg','audio/ogg'];
 if(bytes.length>=2&&bytes[0]===255&&(bytes[1]&246)===240)return ['aac','audio/aac'];
 if(bytes.subarray(0,3).equals(Buffer.from('ID3'))||(bytes.length>=2&&bytes[0]===255&&(bytes[1]&224)===224))return ['mp3','audio/mpeg'];
 fail('audio_format_unsupported',422);
}
export function createBoundedAudioDecoder({path,sha256}={}){
 if(typeof path!=='string'||!isAbsolute(path)||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))fail('decoder_pin_required',503);
 return async(bytes,{signal}={})=>{
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>25*1024*1024)fail('input_too_large',413);
  if(checksum(await readFile(path))!==sha256)fail('decoder_pin_mismatch',503);
  const [demuxer,mime]=format(bytes);if(signal?.aborted)fail('cancelled',499);
  const sampleBytes=await new Promise((resolve,reject)=>{
   let output=0,reason=null;const child=spawn(path,['-hide_banner','-loglevel','error','-nostdin','-max_alloc','33554432','-protocol_whitelist','pipe','-format_whitelist',demuxer,'-codec_whitelist',{mp3:'mp3,mp3float',ogg:'opus,vorbis',flac:'flac',aac:'aac,aac_fixed'}[demuxer],'-threads','1','-f',demuxer,'-i','pipe:0','-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','24000','-f','s16le','pipe:1'],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP}});
   const stop=(code,status)=>{reason??=new AdapterError(code,status);child.kill();};
   const timer=setTimeout(()=>stop('decoder_deadline_exceeded',504),10000);const abort=()=>stop('cancelled',499);signal?.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',chunk=>{output+=chunk.length;if(output>20*24000*2)stop('audio_duration_exceeded',422);});
   child.stdin.on('error',()=>{});child.on('error',()=>{reason??=new AdapterError('decoder_unavailable',503);});
   child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(reason)reject(reason);else if(code!==0||output===0||output%2)reject(new AdapterError('audio_invalid',422));else resolve(output);});
   child.stdin.end(bytes);
  });
  return {mime,duration:sampleBytes/(24000*2),sample_rate:24000,channels:1,sha256:checksum(bytes),size:bytes.length};
 };
}
