import "server-only";
import type {Pool} from "pg";
import {buildUploadObjectKey} from "@/lib/server/creative/object-keys";
import {randomUUID,createHash} from "node:crypto";
import {database} from "@/lib/server/database";
import {localStorage} from "@/lib/server/creative/storage";
import {requireCreativeStudio} from "@/lib/server/creative/feature-control";
import {enforceSameOriginForCookieMutation} from "@/lib/server/auth";
import type { NextRequest } from "next/server";
import { authorize } from "@/lib/server/authorization";
const {readSmartLabsConfig,createSmartLabsAdapters}:typeof import("@tanaghom/agent-runtime/smartlabs")
 =process.getBuiltinModule("module").createRequire(`${process.cwd()}/package.json`)("@tanaghom/agent-runtime/smartlabs");
type Capabilities=Pick<import("@tanaghom/agent-runtime/smartlabs").AdapterDependencies,"tokenCounter"|"thinkingDisabled"|"inspectCompressed"|"readBilling"> & {workerPool?:Pool};
function error(code:string,status=400):never {throw Object.assign(new Error(code),{code,status});}
function denied():never {throw Object.assign(new Error("adapter_disabled"),{code:"adapter_disabled",status:503});}
// Trusted authenticated callers only. No public route and no caller-supplied actor.
export async function smartLabsRuntime(request:NextRequest,capabilities:Capabilities={}) {
 const user=await authorize(request,["owner","operator"]);
 const config=readSmartLabsConfig(process.env);
 const clients=createSmartLabsAdapters(config,{...capabilities,readControlledAudio:async versionId=>{
  const row=(await database().query(`SELECT v.id,v.asset_id,v.job_id,v.object_key,v.mime,v.bytes,v.sha256,a.organization_id,j.correlation_id
   FROM tanaghom.creative_asset_versions v JOIN tanaghom.creative_assets a ON a.id=v.asset_id
   JOIN tanaghom.creative_jobs j ON j.id=v.job_id AND j.organization_id=a.organization_id
   WHERE v.id=$1 AND a.organization_id=$2 AND v.status = 'approved'`,[versionId,user.organizationId])).rows[0];
  if(!row||Number(row.bytes)>25*1024*1024||Number(row.bytes)<1||!row.object_key.startsWith(`t/${user.organizationId}/`))return null;
  const stored=await localStorage().get(row.object_key,25*1024*1024);
  if(!stored||stored.bytes.length!==Number(row.bytes)||stored.mime!==row.mime)return null;
  return {bytes:stored.bytes,mime:row.mime,sha256:row.sha256,versionId:row.id,assetId:row.asset_id,jobId:row.job_id};
 }});
 async function requireExecution(){
  // Existing API SELECT grant; current authoritative control, not a caller flag
  // or a historical worker claim. This read is not atomic stop/dispatch exclusion.
  let control;
  try{control=(await database().query('SELECT enabled,emergency_stop FROM tanaghom.creative_controls WHERE singleton=true')).rows[0];}catch{error('creative_execution_disabled',503);}
  if(control?.enabled!==true||control?.emergency_stop!==false)error('creative_execution_disabled',503);
 }
 async function voiceJob(jobId:string,minimumLeaseMs:number){
  const job=(await database().query(`SELECT j.id,j.requested_by,j.organization_id,j.capability,j.status,j.claimed_by,j.lease_expires_at,j.cancel_requested,j.correlation_id
   FROM tanaghom.creative_jobs j WHERE j.id=$1 AND j.organization_id=$2`,[jobId,user.organizationId])).rows[0];
  const expiry=job?new Date(job.lease_expires_at).getTime():NaN;
  if(!job||job.capability!=="voice"||job.status!=="running"||job.cancel_requested||typeof job.claimed_by!=="string"||!job.claimed_by||!Number.isFinite(expiry)||expiry<Date.now()+minimumLeaseMs)error("owned_active_voice_job_required",409);
  return job;
 }
 const runtime={
  gemma:{complete:(input:Record<string,unknown>,options?:{signal?:AbortSignal})=>config.gemmaEnabled?clients.gemma.complete(input,options):Promise.reject(Object.assign(new Error("adapter_disabled"),{code:"adapter_disabled",status:503}))},
  tts:{async synthesizeToAsset(input:{jobId:string;text:string},options?:{signal?:AbortSignal}){
   if(!config.ttsEnabled)denied();requireCreativeStudio();enforceSameOriginForCookieMutation(request);await requireExecution();
   if(!input||typeof input!=="object"||Object.keys(input).some(k=>!["jobId","text"].includes(k))||typeof input.jobId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.jobId)||typeof input.text!=="string"||!input.text.trim()||Array.from(input.text).length>500)error("tts_input_invalid");
   if(!capabilities.workerPool)error("controlled_worker_pool_required",503);
   const job=await voiceJob(input.jobId,180000);
   const inputHash=createHash('sha256').update(input.text).digest('hex');
   // Autocommitted BEFORE paid generation. A crash/timeout cannot remove this
   // one-attempt guard. Scope uses the job's original requester, not current actor.
   const guard=(await database().query(`INSERT INTO tanaghom.api_idempotency_keys(actor_user_id,operation_type,idempotency_key,request_hash,status)
    VALUES($1,'smartlabs.tts',$2,$3,'processing') ON CONFLICT(actor_user_id,operation_type,idempotency_key) DO NOTHING RETURNING id`,[job.requested_by,job.id,'sha256:'+inputHash])).rows[0];
   if(!guard)error("attempt_already_reserved",409);
   const result=await clients.tts.synthesize({text:input.text},options);
   const key=buildUploadObjectKey({organizationId:user.organizationId,capability:"voice",nonce:randomUUID(),version:1,mime:result.mime});
   const storage=localStorage();let stored=false,commitAttempted=false;const worker=await capabilities.workerPool.connect();
   try{
    const put=await storage.put(key,result.bytes,result.mime);stored=true;if(put.sha256!==result.sha256)error("storage_checksum_invalid",500);
    const read=await storage.get(key,25*1024*1024);if(!read||createHash('sha256').update(read.bytes).digest('hex')!==result.sha256)error("storage_readback_failed",500);
    await worker.query('BEGIN');
    const version=(await worker.query(`SELECT tanaghom.create_creative_asset_version($1,$2,NULL,$3,$4,NULL,NULL,$5,$6,$7,$8,NULL,$9::jsonb,NULL,NULL,'render') AS id`,[job.id,job.claimed_by,"Arabic speech draft",result.mime,Math.round(result.duration*1000),result.size,result.sha256,key,JSON.stringify({adapter:'smartlabs.tts',backend:result.backend,metadata:result.metadata,input_hash:inputHash,sample_rate:result.sample_rate,channels:result.channels})])).rows[0].id;
    await worker.query('SELECT tanaghom.complete_creative_job($1,$2,$3,NULL)',[job.id,job.claimed_by,version]);
    commitAttempted=true;await worker.query('COMMIT');
    const verified=(await database().query(`SELECT v.id,v.asset_id,v.job_id,v.status FROM tanaghom.creative_asset_versions v
     JOIN tanaghom.creative_assets a ON a.id=v.asset_id WHERE v.id=$1 AND a.organization_id=$2`,[version,user.organizationId])).rows[0];
    if(!verified||verified.job_id!==job.id||verified.status!=="draft")error("asset_recovery_required",503);
    const receipt={assetId:verified.asset_id,assetVersionId:version,jobId:job.id,status:"draft",sha256:result.sha256,mime:result.mime,duration:result.duration,size:result.size,sample_rate:result.sample_rate,channels:result.channels,backend:result.backend,metadata:result.metadata};
    await database().query(`UPDATE tanaghom.api_idempotency_keys SET status='completed',response_status=200,response_body=$2::jsonb,completed_at=now() WHERE id=$1`,[guard.id,JSON.stringify(receipt)]);
    return receipt;
   }catch{
    if(!commitAttempted){await worker.query('ROLLBACK').catch(()=>{});if(stored)await storage.remove(key).catch(()=>{});}
    // Unknown COMMIT retains private bytes and durable reservation for operator recovery.
    error("asset_recovery_required",503);
   }finally{worker.release();}
  }},
  asr:{async transcribe(input:{sourceVersionId:string},options?:{signal?:AbortSignal}){
   if(!config.asrEnabled)denied();requireCreativeStudio();enforceSameOriginForCookieMutation(request);await requireExecution();
   const result=await clients.asr.transcribe(input,options);
   await database().query(`INSERT INTO tanaghom.agent_actions_log(correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
    SELECT j.correlation_id,$1,'smartlabs.asr.transcribed','creative_asset_version',$2,$3::jsonb,'success'
    FROM tanaghom.creative_jobs j WHERE j.id=$4 AND j.organization_id=$5`,[user.id,result.source.versionId,JSON.stringify({source:result.source,metadata:result.metadata,transcript_sha256:createHash('sha256').update(result.text).digest('hex'),transcript_characters:Array.from(result.text).length}),result.source.jobId,user.organizationId]);
   return result;
  }},
  async smoke(input:{jobId:string;confirmation:string}):Promise<Record<string,unknown>>{
   if(!input||Object.keys(input).some(k=>!["jobId","confirmation"].includes(k))||input.confirmation!=="ISSUE242_ONE_ATTEMPT")error("smoke_confirmation_required",403);
   await authorize(request,["owner"]);requireCreativeStudio();enforceSameOriginForCookieMutation(request);await requireExecution();
   if(!config.gemmaEnabled||!config.ttsEnabled||!config.asrEnabled||!config.gemmaKey||!config.apiKey||!capabilities.tokenCounter||capabilities.thinkingDisabled!==true||!capabilities.workerPool)error("smoke_configuration_required",503);
   if(typeof input.jobId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.jobId))error("smoke_job_invalid");
   await voiceJob(input.jobId,240000);
   const client=await database().connect();let reservation:string;
   try{
    await client.query('BEGIN');
    const lock=(await client.query(`SELECT pg_try_advisory_xact_lock(hashtextextended('smartlabs.smoke.issue242',0)) AS locked`)).rows[0];
    if(lock?.locked!==true)error("smoke_busy",429);
    const existing=await client.query(`SELECT id FROM tanaghom.api_idempotency_keys WHERE operation_type='smartlabs.smoke.issue242' LIMIT 1`);
    if(existing.rows.length)error("smoke_already_reserved",409);
    const guard=(await client.query(`INSERT INTO tanaghom.api_idempotency_keys(actor_user_id,operation_type,idempotency_key,request_hash,status)
     VALUES($1,'smartlabs.smoke.issue242','issue242-one-attempt',$2,'processing') RETURNING id`,[user.id,'sha256:'+createHash('sha256').update(input.jobId).digest('hex')])).rows[0];
    reservation=guard.id;await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
   // The committed group guard is NEVER cleared on interruption or failure.
   const g1=await runtime.gemma.complete({messages:[{role:'user',content:'أجب بتحية عربية قصيرة.'}],temperature:0,max_tokens:64});
   const t1=await runtime.tts.synthesizeToAsset({jobId:input.jobId,text:'مرحبا بكم في تناغم.'});
   // Never autoapprove generated audio or upload a draft. Resume A1 only via
   // the existing ASR method after a human uses the existing decision API.
   // This completed durable receipt retains the same source; no G1/T1 rerun.
   const receipt={status:'REVIEW_REQUIRED',issue:242,G1:{metadata:g1.metadata,sha256:createHash('sha256').update(g1.text).digest('hex'),arabic:/[\u0600-\u06ff]/u.test(g1.text)},T1:t1,A1:{status:'NOT_RUN_REQUIRES_APPROVED_SOURCE',sourceVersionId:t1.assetVersionId},quality_certified:false,production_activated:false};
   await database().query(`UPDATE tanaghom.api_idempotency_keys SET status='completed',response_status=200,response_body=$2::jsonb,completed_at=now() WHERE id=$1`,[reservation,JSON.stringify(receipt)]);
   return receipt;
  },
  async health(){return {gemma:config.gemmaEnabled?{enabled:true,configured:!!config.gemmaKey,inventory:await clients.gemma.models()}:{enabled:false,configured:!!config.gemmaKey},tts:{enabled:config.ttsEnabled,configured:!!config.apiKey&&config.ttsBackend==="omnivoice"&&config.voiceId==="smarttts2-xms-default",probe:"configuration_only"},asr:{enabled:config.asrEnabled,configured:!!config.apiKey&&config.language==="ar",probe:"configuration_only"}};},
 };
 return runtime;
}
