import "server-only";
import {createHash} from 'node:crypto';
import type {NextRequest} from 'next/server';
import {authorize} from '@/lib/server/authorization';
import {enforceSameOriginForCookieMutation} from '@/lib/server/auth';
import {database} from '@/lib/server/database';
import {noStore} from '@/lib/server/responses';
import {requireCreativeStudio,CreativeDisabledError} from '@/lib/server/creative/feature-control';
import {reserveIdempotency,completeIdempotency,idempotencyKey,IdempotencyRequestError} from '@/lib/server/creative/idempotency';
import {CreativeJobRequestError} from '@/lib/server/creative/jobs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const specs:Record<string,string[]>={create_avatar:['name','avatar_type'],add_binding:['avatar_id','provider','provider_avatar_id','voice_id','policy_approved'],add_consent:['avatar_id','subject_reference','subject_name','consent_type','usage_scope','obtained_at','expires_at','evidence_asset_version_id','notes'],set_avatar_status:['id','status'],set_binding_status:['id','status'],revoke_consent:['id']};
function fail(code:string,status=400):never{throw new CreativeJobRequestError(code,status);}
async function manage(request:NextRequest){
 requireCreativeStudio();enforceSameOriginForCookieMutation(request);const user=await authorize(request,['owner']);
 const body=await request.json().catch(()=>fail('invalid_json'));
 if(!body||typeof body!=='object'||Array.isArray(body)||!specs[body.action]||Object.keys(body).some(k=>!['action','correlation_id',...specs[body.action]].includes(k)))fail('invalid_avatar_action');
 if(typeof body.correlation_id!=='string'||!uuid.test(body.correlation_id))fail('invalid_correlation_id');
 for(const k of ['id','avatar_id','evidence_asset_version_id'])if(body[k]!==undefined&&(typeof body[k]!=='string'||!uuid.test(body[k])))fail('invalid_'+k);
 for(const k of ['name','provider_avatar_id','voice_id','subject_reference','subject_name','consent_type','notes'])if(body[k]!==undefined&&(typeof body[k]!=='string'||!body[k].trim()||body[k].length>(k==='notes'?2000:200)))fail('invalid_'+k);
 const client=await database().connect();
 try{
  await client.query('BEGIN');const slot=await reserveIdempotency(client,user.id,'creative.avatar.manage',idempotencyKey(request),'sha256:'+createHash('sha256').update(JSON.stringify(body)).digest('hex'));
  if(slot.replayed){await client.query('COMMIT');return noStore(slot.response_body,{status:slot.response_status});}
  if(body.action==='create_avatar'){
   if(!body.name||!['provider_stock','synthetic','custom_real_person'].includes(body.avatar_type))fail('invalid_avatar');
   if(body.avatar_type==='custom_real_person'&&process.env.CUSTOM_AVATAR_ENABLED!=='true')fail('custom_avatar_disabled',503);
  }else if(body.action==='add_binding'){
   if(!body.avatar_id||!['heygen','sync'].includes(body.provider)||!body.provider_avatar_id||body.policy_approved!==true||(body.provider==='heygen'&&!body.voice_id))fail('binding_approval_required');
  }else if(body.action==='add_consent'){
   if(process.env.CUSTOM_AVATAR_ENABLED!=='true')fail('custom_avatar_disabled',503);
   if(!body.avatar_id||!body.subject_reference||!body.subject_name||!body.consent_type||!body.evidence_asset_version_id||!Array.isArray(body.usage_scope)||!body.usage_scope.length||body.usage_scope.some((x:unknown)=>!['talking_head','lip_sync'].includes(x as string))||typeof body.obtained_at!=='string'||!Number.isFinite(Date.parse(body.obtained_at))||Date.parse(body.obtained_at)>Date.now()||(body.expires_at!==undefined&&body.expires_at!==null&&(typeof body.expires_at!=='string'||!Number.isFinite(Date.parse(body.expires_at)))))fail('invalid_consent');
  }else{
   if(!body.id)fail('id_required');
   if(body.action!=='revoke_consent'&&!['active','inactive','blocked','revoked'].includes(body.status))fail('invalid_status');
  }
  const id:string=(await client.query('SELECT tanaghom.manage_creative_presenter($1,$2,$3,$4) AS id',[user.id,body.action,body,process.env.CUSTOM_AVATAR_ENABLED==='true'])).rows[0].id;
  await client.query("INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result) VALUES($1,$2,'creative.avatar_governance','creative_avatar',$3,$4,'success')",[body.correlation_id,user.id,id,{action:body.action,avatar_id:body.avatar_id??null,status:body.status??null}]);
  const response={ok:true,id,action:body.action,correlation_id:body.correlation_id};await completeIdempotency(client,(slot as {reservation_id:string}).reservation_id,200,response);await client.query('COMMIT');return noStore(response);
 }catch(error){await client.query('ROLLBACK');if(error&&typeof error==='object'&&'code'in error&&error.code==='P0002')fail(body.action==='revoke_consent'?'consent_not_found':'avatar_not_found',404);if(error&&typeof error==='object'&&'code'in error&&['P0001','23503','23514','22P02'].includes(String(error.code)))fail('avatar_governance_denied',403);throw error;}finally{client.release();}
}
export async function managePresenter(request:NextRequest){try{return await manage(request);}catch(error){if(error instanceof CreativeJobRequestError||error instanceof IdempotencyRequestError)return noStore({error:error.code},{status:error.status});if(error instanceof CreativeDisabledError)return noStore({error:'creative_studio_disabled'},{status:503});throw error;}}
