import "server-only";
import {createHash,randomUUID} from "node:crypto";
import type {NextRequest} from "next/server";
import {authorize} from "@/lib/server/authorization";
import {enforceSameOriginForCookieMutation} from "@/lib/server/auth";
import {database} from "@/lib/server/database";
import {noStore} from "@/lib/server/responses";
import {requireCreativeStudio,CreativeDisabledError} from "@/lib/server/creative/feature-control";
import {CreativeJobRequestError} from "@/lib/server/creative/jobs";
import {reserveIdempotency,completeIdempotency,idempotencyKey,IdempotencyRequestError} from "@/lib/server/creative/idempotency";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
function fail(code:string,status=400):never{throw new CreativeJobRequestError(code,status);}
export async function submitPresenter(request:NextRequest){
 try{
  requireCreativeStudio();enforceSameOriginForCookieMutation(request);
  const user=await authorize(request,['owner','operator']);
  const body=await request.json().catch(()=>fail('invalid_json'));
  if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid_request');
  const op=body.operation;
  if(!['talking_head','lip_sync'].includes(op))fail('invalid_operation');
  if(process.env[op==='talking_head'?'TALKING_HEAD_ENABLED':'LIP_SYNC_ENABLED']!=='true')fail('presenter_disabled',503);
  const allowed=['operation','avatar_id','binding_id','correlation_id','duration',...(op==='talking_head'?['script','locale','ratio']:['source_video_version_id','source_audio_version_id'])];
  if(Object.keys(body).some(k=>!allowed.includes(k)))fail('unknown_field');
  for(const key of ['avatar_id','binding_id','correlation_id',...(op==='lip_sync'?['source_video_version_id','source_audio_version_id']:[])])if(typeof body[key]!=='string'||!uuid.test(body[key]))fail('invalid_'+key);
  if(!Number.isInteger(body.duration)||body.duration<1||body.duration>60)fail('invalid_duration');
  if(op==='talking_head'&&(typeof body.script!=='string'||!body.script.trim()||body.script.length>5000||!['ar','en','ar-EN'].includes(body.locale)||!['16:9','9:16','1:1'].includes(body.ratio)))fail('invalid_script');
  const {correlation_id:correlation,...params}=body;
  if(op==='talking_head'){params.script_hash=sha(params.script);params.script_length=Array.from(params.script).length;}
  const client=await database().connect();
  try{
   await client.query('BEGIN');const key=idempotencyKey(request);
   const slot=await reserveIdempotency(client,user.id,'creative.presenter.generate',key,'sha256:'+sha(JSON.stringify(body)));
   if(slot.replayed){await client.query('COMMIT');const response=noStore(slot.response_body,{status:slot.response_status});response.headers.set('Idempotency-Replayed','true');return response;}
   const auth=(await client.query('SELECT tanaghom.authorize_creative_presenter($1,$2,$3,$4) AS auth',[user.organizationId,params.avatar_id,params.binding_id,op])).rows[0].auth;
   if(auth.consent_id)params.consent_id=auth.consent_id;
   await client.query('SELECT tanaghom.validate_creative_presenter_params($1,$2)',[user.organizationId,params]);
   if(auth.avatar_type==='custom_real_person'&&process.env.CUSTOM_AVATAR_ENABLED!=='true')fail('custom_avatar_disabled',503);
   const job=(await client.query('SELECT tanaghom.create_creative_job($1,$2,$3,$4,$5,$6,0,3,NULL,NULL,NULL) AS job_id',[user.id,op,'gpu_video',params,randomUUID(),correlation])).rows[0].job_id;
   await client.query(`INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result) VALUES($1,$2,'creative.job_enqueued','creative_job',$3,$4,'success')`,[correlation,user.id,job,{operation:op,avatar_id:params.avatar_id,binding_id:params.binding_id,script_hash:params.script_hash??null,script_length:params.script_length??null,locale:params.locale??null}]);
   const response={ok:true,job_ids:[job],correlation_id:correlation,estimate:{estimated_cost_usd:null,actual_cost_usd:null,informational_only:true}};
   await completeIdempotency(client,(slot as {reservation_id:string}).reservation_id,200,response);await client.query('COMMIT');return noStore(response);
  }catch(error){await client.query('ROLLBACK');if(error&&typeof error==='object'&&'code'in error&&['P0001','22P02','23514'].includes(String(error.code)))fail('presenter_not_authorized',403);throw error;}finally{client.release();}
 }catch(error){
  if(error instanceof CreativeJobRequestError||error instanceof IdempotencyRequestError)return noStore({error:error.code},{status:error.status});
  if(error instanceof CreativeDisabledError)return noStore({error:'creative_studio_disabled'},{status:503});throw error;
 }
}
export async function presenterCatalog(request:NextRequest){
 requireCreativeStudio();const user=await authorize(request,['owner','operator','reviewer','viewer']);
 const catalog=(await database().query('SELECT tanaghom.read_creative_presenter_catalog($1) AS catalog',[user.id])).rows[0].catalog;
 const flags=catalog.flags;
 return noStore({avatars:catalog.avatars,inputs:catalog.inputs,jobs:catalog.jobs,flags:{talking_head:flags.talking_head_enabled&&process.env.TALKING_HEAD_ENABLED==='true',lip_sync:flags.lip_sync_enabled&&process.env.LIP_SYNC_ENABLED==='true',custom_avatar:flags.custom_avatar_enabled&&process.env.CUSTOM_AVATAR_ENABLED==='true'},gates:{source:'IN_PROGRESS',provider:'NOT_ACCEPTED',custom_avatar:'NOT_ACCEPTED',production:'NOT_CERTIFIED'}});
}
