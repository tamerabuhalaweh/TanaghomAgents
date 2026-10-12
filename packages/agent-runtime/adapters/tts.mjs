import {closed,fail,acceptResponse} from './http.mjs';
import {inspectWav,checksum} from './audio.mjs';
export class TtsAdapter {
 constructor({transport,backend}){this.transport=transport;this.backend=backend;}
 async synthesize(input,{signal}={}){
  closed(input,['text']);if(typeof input.text!=='string'||!input.text.trim()||Array.from(input.text).length>500||!/[\u0600-\u06ff]/u.test(input.text)||/[\u0000-\u0008]/u.test(input.text))fail('text_invalid');
  return acceptResponse(this.transport,[input.text,signal],response=>{if(response.contentType!=='audio/wav')fail('audio_invalid',502);
  const info=inspectWav(response.bytes,{maxDuration:120,tts:true});
  return {...info,bytes:response.bytes,backend:this.backend,metadata:{...response.metadata,inputHash:checksum(Buffer.from(input.text)),inputCharacters:Array.from(input.text).length,billing:response.metadata.billing??null}};});
 }
}
