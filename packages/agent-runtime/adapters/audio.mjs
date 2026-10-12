import { createHash } from 'node:crypto';
import { fail } from './http.mjs';
export const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
export function inspectWav(bytes,{maxDuration=20,tts=false}={}){
 if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>25*1024*1024||!bytes.subarray(0,4).equals(Buffer.from('RIFF'))||!bytes.subarray(8,12).equals(Buffer.from('WAVE'))||bytes.readUInt32LE(4)+8!==bytes.length)fail('audio_invalid',422);
 let fmt,data,offset=12;
 while(offset<bytes.length){if(offset+8>bytes.length)fail('audio_invalid',422);const size=bytes.readUInt32LE(offset+4),end=offset+8+size;if(end>bytes.length)fail('audio_invalid',422);const id=bytes.subarray(offset,offset+4);
  if(id.equals(Buffer.from('fmt '))){if(fmt||size!==16)fail('audio_invalid',422);fmt={codec:bytes.readUInt16LE(offset+8),channels:bytes.readUInt16LE(offset+10),sample_rate:bytes.readUInt32LE(offset+12),byteRate:bytes.readUInt32LE(offset+16),align:bytes.readUInt16LE(offset+20),bits:bytes.readUInt16LE(offset+22)};}
  if(id.equals(Buffer.from('data'))){if(data)fail('audio_invalid',422);data=bytes.subarray(offset+8,end);}
  offset=end+(size%2);if(offset>bytes.length)fail('audio_invalid',422);
 }
 if(!fmt||!data||!data.length||fmt.codec!==1||fmt.bits!==16||![1,2].includes(fmt.channels)||fmt.sample_rate<8000||fmt.sample_rate>96000||fmt.align!==fmt.channels*2||fmt.byteRate!==fmt.sample_rate*fmt.align||data.length%fmt.align!==0)fail('audio_invalid',422);
 const duration=data.length/fmt.byteRate;if(duration<=0||duration>maxDuration)fail('audio_duration_exceeded',422);
 if(tts&&(fmt.channels!==1||fmt.sample_rate!==24000||!data.some(x=>x!==0)))fail('audio_invalid',422);
 return {mime:'audio/wav',duration,sample_rate:fmt.sample_rate,channels:fmt.channels,sha256:checksum(bytes),size:bytes.length};
}
