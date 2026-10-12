// Accepted public v3 transport; conditional SOURCE ONLY, no enrollment/cancel.
import { ProviderAdapterError } from './http-image.mjs';
import {readProviderJson} from './provider-json.mjs';
export function createHeyGenAdapter({apiKey, fetchImpl=fetch, endpoint='https://api.heygen.com', testLoopback=false, artifactOrigins=[]}) {
 const base=new URL(endpoint);
 if(base.origin!==endpoint || (endpoint!=='https://api.heygen.com' && !(testLoopback && base.protocol==='http:' && base.hostname==='127.0.0.1'))) throw new Error('heygen_endpoint_rejected');
 if(!apiKey) throw new Error('heygen_key_required');
 async function request(path,method='GET',body=null,key=null){
  let response;
  try { response=await fetchImpl(endpoint+path,{method,redirect:'error',signal:AbortSignal.timeout(120000),headers:{'X-Api-Key':apiKey,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})}); }
  catch {throw new ProviderAdapterError('indeterminate','heygen_transport_unknown');}
  if(!response.ok) throw new ProviderAdapterError(response.status===429?'capacity':response.status>=500?'indeterminate':'deterministic',`heygen_http_${response.status}`);
  return (await readProviderJson(response)).data;
 }
 return Object.freeze({name:'heygen',model:'avatar_iv',modelVersion:'v3',artifactOrigins,testLoopback,maxBytes:100*1024*1024,
  async createTalkingHead({script,locale,ratio='16:9',providerAvatarId,voiceId,idempotencyKey}) {
   if(typeof script!=='string'||!script.trim()||script.length>5000||!['ar','en','ar-EN'].includes(locale)||!['16:9','9:16','1:1'].includes(ratio)||!providerAvatarId||!voiceId||!idempotencyKey||! /^[A-Za-z0-9_:.-]{1,255}$/.test(idempotencyKey)) throw new Error('heygen_input_invalid');
   const data=await request('/v3/videos','POST',{type:'avatar',avatar_id:providerAvatarId,script,voice_id:voiceId,engine:{type:'avatar_iv'},resolution:'720p',aspect_ratio:ratio,output_format:'mp4',callback_id:idempotencyKey},idempotencyKey);
   if(typeof data?.video_id!=='string'||!data.video_id)throw new ProviderAdapterError('indeterminate','heygen_create_unknown');
   return {taskId:data.video_id};
  },
  async queryTask(id){
   if(typeof id!=='string'||!id||id.length>300)throw new Error('heygen_task_invalid');
   const data=await request('/v3/videos/'+encodeURIComponent(id));
   const status={pending:'running',waiting:'running',processing:'running',completed:'succeeded',failed:'failed',cancelled:'cancelled'}[data?.status];
   if(!status)throw new ProviderAdapterError('indeterminate','heygen_status_unknown');
   return {status,url:data.video_url??null,duration:data.duration??null,actualCostUsd:null};
  },
  async retrieveResult(id){return this.queryTask(id);}
 });
}
