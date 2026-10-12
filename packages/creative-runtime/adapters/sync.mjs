// Independent existing-video + existing-audio adapter. No URL/TTS/enrollment.
// Direct multipart is documented at generate-api/create-with-files.
import { ProviderAdapterError } from './http-image.mjs';
import {readProviderJson} from './provider-json.mjs';
export function createSyncAdapter({apiKey,fetchImpl=fetch,endpoint='https://api.sync.so',testLoopback=false,artifactOrigins=[],model='lipsync-2'}) {
 const base=new URL(endpoint);
 if(base.origin!==endpoint||(endpoint!=='https://api.sync.so'&&!(testLoopback&&base.protocol==='http:'&&base.hostname==='127.0.0.1')))throw new Error('sync_endpoint_rejected');
 if(!apiKey||model!=='lipsync-2')throw new Error('sync_configuration_rejected');
 async function request(path,body=null,key=null){
  let response;
  try{response=await fetchImpl(endpoint+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(120000),headers:{'x-api-key':apiKey,...(key?{'Idempotency-Key':key}:{})},...(body?{body}:{})});}
  catch{throw new ProviderAdapterError('indeterminate','sync_transport_unknown');}
  if(!response.ok)throw new ProviderAdapterError(response.status===429?'capacity':response.status>=500?'indeterminate':'deterministic',`sync_http_${response.status}`);
  return readProviderJson(response);
 }
 return Object.freeze({name:'sync',model,modelVersion:'v2',testLoopback,artifactOrigins,maxBytes:100*1024*1024,
  async createLipSync(input){
   const {video,audio,idempotencyKey}=input??{};
   if(Object.keys(input??{}).some(k=>!['video','audio','idempotencyKey'].includes(k))||!Buffer.isBuffer(video?.bytes)||video.mime!=='video/mp4'||!Buffer.isBuffer(audio?.bytes)||!['audio/wav','audio/mpeg'].includes(audio.mime)||! /^[A-Za-z0-9._~-]{1,128}$/.test(idempotencyKey??''))throw new Error('sync_input_invalid');
   const form=new FormData();form.set('model',model);
   form.set('video',new Blob([video.bytes],{type:video.mime}),'approved.mp4');
   form.set('audio',new Blob([audio.bytes],{type:audio.mime}),audio.mime==='audio/wav'?'approved.wav':'approved.mp3');
   form.set('options',JSON.stringify({sync_mode:'cut_off',output_format:'mp4'}));form.set('outputFileName','tanaghom_'+idempotencyKey);
   const data=await request('/v2/generate',form,idempotencyKey);
   if(typeof data?.id!=='string'||!data.id)throw new ProviderAdapterError('indeterminate','sync_create_unknown');
   return {taskId:data.id};
  },
  async queryTask(id){
   if(typeof id!=='string'||!id||id.length>300)throw new Error('sync_task_invalid');
   const data=await request('/v2/generate/'+encodeURIComponent(id));
   const status={PENDING:'running',PROCESSING:'running',COMPLETED:'succeeded',FAILED:'failed',REJECTED:'failed',CANCELLED:'cancelled'}[data?.status];
   if(!status)throw new ProviderAdapterError('indeterminate','sync_status_unknown');
   return {status,url:data.outputUrl??null,duration:data.outputDuration??null,actualCostUsd:null};
  },
  async retrieveResult(id){return this.queryTask(id);}
 });
}
