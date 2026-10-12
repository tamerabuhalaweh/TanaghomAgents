// SmartLabs URLs, authentication and wire fields live only here.
import {openSync,readSync,fstatSync,closeSync,constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import { GemmaAdapter } from '../adapters/gemma.mjs';
import { TtsAdapter } from '../adapters/tts.mjs';
import { AsrAdapter } from '../adapters/asr.mjs';
import { boundedHttp, endpoint, fail, AdapterError } from '../adapters/http.mjs';
// Shared across factory instances/module reloads in this process, NOT distributed.
const slots=globalThis[Symbol.for('tanaghom.smartlabs.admission')]??=new Map();
async function admit(scope,enabled,operation){
 if(enabled!==true)fail('adapter_disabled',503);
 const slot=slots.get(scope);if(slot?.until&&slot.until<=Date.now())slots.delete(scope);
 if(slots.has(scope))fail(slot?.until?'provider_cooldown':slot==='unknown'?'outcome_recovery_required':'local_busy',429,slot?.until?{retryAfterSeconds:Math.ceil((slot.until-Date.now())/1000)}:{});
 slots.set(scope,'active');let unknown=false;
 try{return await operation();}catch(error){unknown=error.metadata?.indeterminate===true;if(unknown)slots.set(scope,'unknown');else if(error.status===429&&error.metadata?.retryAfterSeconds>0){unknown=true;slots.set(scope,{until:Date.now()+error.metadata.retryAfterSeconds*1000});}throw error;}finally{if(!unknown)slots.delete(scope);}
}
// Server-only secret import. Never trim credentials or expose file paths/causes.
function secret(env,name){
 const direct=env[name],file=env[name+'_FILE'];
 if(direct!==undefined&&file!==undefined)fail('credentials_configuration_invalid',503);
 let value=direct??'';
 if(file!==undefined){
  let fd;
  try{
   if(typeof file!=='string'||!isAbsolute(file))throw new Error();
   fd=openSync(file,constants.O_RDONLY|constants.O_NONBLOCK);
   const stat=fstatSync(fd);if(!stat.isFile()||stat.size<1||stat.size>4096)throw new Error();
   const bytes=Buffer.alloc(4097);let total=0,n;
   while((n=readSync(fd,bytes,total,bytes.length-total,null))>0){total+=n;if(total>4096)throw new Error();}
   value=bytes.subarray(0,total).toString('utf8').replace(/\r?\n$/,'');
  }catch{fail('credentials_configuration_invalid',503);}finally{if(fd!==undefined)closeSync(fd);}
 }
 if(typeof value!=='string'||(value!==''&&!/^[\x21-\x7e]{1,4096}$/.test(value))||(file!==undefined&&value===''))fail('credentials_configuration_invalid',503);
 return value;
}
export function readSmartLabsConfig(env){
 const gemmaKey=secret(env,'SMARTLABS_GEMMA_API_KEY'),apiKey=secret(env,'SMARTLABS_API_KEY');
 if((env.SMARTLABS_GEMMA_ENABLED==='true'&&!gemmaKey)||((env.SMARTLABS_TTS_ENABLED==='true'||env.SMARTLABS_ASR_ENABLED==='true')&&!apiKey))fail('credentials_missing',503);
 return {gemmaBaseUrl:env.SMARTLABS_GEMMA_BASE_URL||'https://api.thesmartlabs.net/gemma4/v1',gemmaKey,model:env.SMARTLABS_GEMMA_MODEL||'gemma4-26b-a4b-canary',apiBaseUrl:env.SMARTLABS_API_BASE_URL||'https://api.thesmartlabs.net/v1',apiKey,asrUrl:env.SMARTLABS_ASR_URL||'https://api.thesmartlabs.net/v1/transcriptions',ttsBackend:env.SMARTLABS_TTS_BACKEND||'omnivoice',voiceId:env.SMARTLABS_TTS_VOICE_ID||'smarttts2-xms-default',language:env.SMARTLABS_ASR_LANGUAGE||'ar',gemmaEnabled:env.SMARTLABS_GEMMA_ENABLED==='true',ttsEnabled:env.SMARTLABS_TTS_ENABLED==='true',asrEnabled:env.SMARTLABS_ASR_ENABLED==='true'};
}
export function createSmartLabsAdapters(config,dependencies={}){
 config={...config};
 if(config.model!=='gemma4-26b-a4b-canary')fail('model_configuration_invalid',503);
 const request=options=>boundedHttp({...options,ownedLoopbackTest:dependencies.ownedLoopbackTest,...(dependencies.ownedLoopbackTest===true&&Number.isInteger(dependencies.testDeadlineMs)&&dependencies.testDeadlineMs>=1?{timeoutMs:Math.min(options.timeoutMs??60000,dependencies.testDeadlineMs)}:{})});
 const base=endpoint(config.gemmaBaseUrl,dependencies.ownedLoopbackTest);
 const acceptPaid=async(response,accept)=>{try{return accept?await accept(response):response;}catch(error){if(error instanceof AdapterError)fail(error.code,error.status,{indeterminate:true});fail('response_invalid',502,{indeterminate:true});}};
 const transport=(operation,body,signal,remainingMs=60000,accept)=>admit('gemma:'+base,config.gemmaEnabled,async()=>{const response=await request({url:base+(operation==='models'?'/models':'/chat/completions'),method:operation==='models'?'GET':'POST',body,signal,timeoutMs:remainingMs,key:config.gemmaKey,header:'authorization'});return operation==='models'?response:acceptPaid(response,accept);});
 const api=endpoint(config.apiBaseUrl,dependencies.ownedLoopbackTest);
 const ttsTransport=(text,signal,accept)=>{
  if(config.ttsBackend!=='omnivoice'||config.voiceId!=='smarttts2-xms-default')fail('tts_configuration_invalid',503);
  return admit('tts:'+api,config.ttsEnabled,async()=>acceptPaid(await request({url:api+'/text-to-speech',body:JSON.stringify({text,tts_backend:'omnivoice',voice_id:'smarttts2-xms-default',dialect_id:'ar-SA'}),signal,key:config.apiKey,header:'x-api-key',maxBytes:8*1024*1024,timeoutMs:150000,readBilling:dependencies.readBilling}),accept));
 };
 const asrUrl=endpoint(config.asrUrl,dependencies.ownedLoopbackTest);
 const asrTransport=({bytes,mime},signal,accept)=>{
  if(config.language!=='ar')fail('asr_configuration_invalid',503);
  const ext={'audio/wav':'wav','audio/mpeg':'mp3','audio/ogg':'ogg','audio/flac':'flac','audio/aac':'aac'}[mime];
  const form=new FormData();form.set('file',new Blob([bytes],{type:mime}),'controlled.'+ext);form.set('language','ar');
  return admit('asr:'+asrUrl,config.asrEnabled,async()=>acceptPaid(await request({url:asrUrl,body:form,signal,key:config.apiKey,header:'x-api-key',timeoutMs:60000}),accept));
 };
 return {asr:new AsrAdapter({transport:asrTransport,readControlledAudio:dependencies.readControlledAudio,inspectCompressed:dependencies.inspectCompressed}),tts:new TtsAdapter({transport:ttsTransport,backend:'omnivoice'}),gemma:new GemmaAdapter({transport,model:config.model,tokenCounter:dependencies.tokenCounter,thinkingDisabled:dependencies.thinkingDisabled,deadlineMs:dependencies.ownedLoopbackTest===true?dependencies.testDeadlineMs:undefined})};
}
