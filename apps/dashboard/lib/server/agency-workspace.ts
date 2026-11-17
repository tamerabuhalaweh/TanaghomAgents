import "server-only";
import { createHash,randomUUID,timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import type { NextRequest } from "next/server";
import { authorize } from "@/lib/server/authorization";
import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { parseOrganizationAgentDraft, agentValidationReport } from "@/lib/server/agent-studio-validation";
import { assertWorkspaceStartAllowed,loadWorkspaceQuota,loadWorkspaceUsage,WorkspaceQuotaError } from "@/lib/server/workspace-quotas";
import { mapWorkspaceStateError } from "@/lib/server/workspace-state-error";
const requireRuntime=process.getBuiltinModule("module").createRequire(`${process.cwd()}/package.json`);
const { workspaceManifest, workspaceRequest, workspaceArtifact, WorkspaceOutputError }: typeof import("@tanaghom/agent-runtime/workspace")
 = requireRuntime("@tanaghom/agent-runtime/workspace");
const { createGeminiWorkspaceClient, GeminiWorkspaceError }: typeof import("@tanaghom/agent-runtime/gemini-workspace")
 = requireRuntime("@tanaghom/agent-runtime/gemini-workspace");
const { inferDialectFromLocation, normalizeDialect, resolveArabicDialect }: typeof import("@tanaghom/agent-runtime/dialects")
 = requireRuntime("@tanaghom/agent-runtime/dialects");
const legacy:typeof import("@tanaghom/agent-runtime/workspace-gemma") = requireRuntime("@tanaghom/agent-runtime/workspace-gemma");

export class WorkspaceError extends Error { constructor(public code:string,public status=409) { super(code); } }
async function requireWorkspaceQuota(client:Parameters<typeof assertWorkspaceStartAllowed>[0],organizationId:string,workspaceId:string){
 try{return await assertWorkspaceStartAllowed(client,organizationId,workspaceId);}
 catch(error){if(error instanceof WorkspaceQuotaError)throw new WorkspaceError(error.code,error.status);throw error;}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const selectedProvider=()=>process.env.AGENCY_WORKSPACE_PROVIDER||"gemma";
const profileId=()=>selectedProvider()==="gemini"?"7d000000-0000-4000-8000-000000000003":"7d000000-0000-4000-8000-000000000002";
declare global { var tanaghomWorkspacePool:Pool|undefined; }
let inventoryCache:{model:string;key:string;expires:number;value:Awaited<ReturnType<ReturnType<typeof createGeminiWorkspaceClient>["inventory"]>>}|null=null;
function geminiApiKey(){
 try{
  const value=readFileSync(/*turbopackIgnore: true*/ process.env.GEMINI_API_KEY_FILE||"/run/secrets/gemini_api_key","utf8").trim();
  return value.length>=20&&value.length<=500&&!/\s/.test(value)?value:null;
 }catch{return null;}
}
const configured=()=>process.env.AGENCY_WORKSPACE_ENABLED==="true" && (selectedProvider()==="gemini"?Boolean(geminiApiKey()):selectedProvider()==="gemma"&&Boolean(process.env.GEMMA_API_KEY?.trim())) && Boolean(process.env.AGENCY_WORKSPACE_DATABASE_URL) && (process.env.AGENCY_WORKSPACE_WORKER_TOKEN?.length||0)>=32;
async function responseJson(response:Response){
 const reader=response.body?.getReader();if(!reader)throw new WorkspaceError("output_rejected");
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>100000){await reader.cancel();throw new WorkspaceError("output_rejected");}chunks.push(part.value);}}
 finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function boundedBody(request:NextRequest) {
 const reader=request.body?.getReader(); if(!reader) throw new WorkspaceError("workspace_body_required",400);
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32000){await reader.cancel();throw new WorkspaceError("workspace_body_too_large",413);}chunks.push(part.value);}
  try { const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!body||Array.isArray(body)||typeof body!=="object")throw new Error();return body as Record<string,unknown>; }
  catch{throw new WorkspaceError("workspace_invalid_json",400);}
 }finally{reader.releaseLock();}
}
function closed(body:Record<string,unknown>,keys:string[]){if(Object.keys(body).some(k=>!keys.includes(k)))throw new WorkspaceError("workspace_unknown_fields",400);}
function identifier(value:unknown){if(typeof value!=="string"||!uuid.test(value))throw new WorkspaceError("workspace_id_invalid",400);return value;}
function workspaceStateError(error:unknown){
 const mapped=mapWorkspaceStateError(error);
 return mapped?new WorkspaceError(mapped.code,mapped.status):null;
}

async function defaultArabicDialect(organizationId:string){
 const result=await database().query(`SELECT o.location,
  (SELECT v.rules->>'arabic_dialect' FROM tanaghom.brand_kits kit
    JOIN tanaghom.brand_kit_versions v ON v.kit_id=kit.id AND v.version=kit.current_version
    WHERE kit.organization_id=o.id ORDER BY kit.created_at DESC,kit.id DESC LIMIT 1) AS brand_dialect
  FROM tanaghom.organizations o WHERE o.id=$1`,[organizationId]);
 const row=result.rows[0]||{};
 const brandDialect=normalizeDialect(row.brand_dialect);
 const inferred=inferDialectFromLocation(row.location);
 return {dialect:brandDialect||inferred||"msa",source:brandDialect?"brand_kit":inferred!=="msa"?"location":"default"};
}

export async function workspaceRead(request:NextRequest){
 const actor=await authorize(request,["owner","reviewer","operator","viewer"]);
 const requested=request.nextUrl.searchParams.get("id");if(requested)identifier(requested);
 const list=await database().query(`SELECT id,title,language,profile_codes,status,error_code,created_at,started_at,finished_at,
  (SELECT l.payload->>'dialect' FROM tanaghom.agent_actions_log l WHERE l.organization_id=$1
    AND l.action_type='workspace.brief_configured' AND l.entity_id=tanaghom.agency_workspaces.id
    ORDER BY l.created_at DESC,l.id DESC LIMIT 1) AS configured_dialect
  FROM tanaghom.agency_workspaces WHERE organization_id=$1 ORDER BY created_at DESC,id LIMIT 40`,[actor.organizationId]);
 const id=requested||list.rows[0]?.id;
 const [control,record,dialectDefault]=await Promise.all([
  database().query(`SELECT enabled,emergency_stop,reason,(SELECT emergency_stop FROM tanaghom.agent_runtime_controls) AS platform_stop FROM tanaghom.agency_workspace_control`),
  id?database().query(`SELECT *,tanaghom.agency_workspace_result_hash(id) AS result_hash,
    (SELECT l.payload->>'dialect' FROM tanaghom.agent_actions_log l WHERE l.organization_id=$2
      AND l.action_type='workspace.brief_configured' AND l.entity_id=tanaghom.agency_workspaces.id
      ORDER BY l.created_at DESC,l.id DESC LIMIT 1) AS configured_dialect
    FROM tanaghom.agency_workspaces WHERE id=$1 AND organization_id=$2`,[id,actor.organizationId]):Promise.resolve({rows:[]}),
  defaultArabicDialect(actor.organizationId),
 ]);
 if(requested&&!record.rows[0])throw new WorkspaceError("workspace_not_found",404);
 const rawSelected=record.rows[0]||null;
 const selected=rawSelected?(({configured_dialect,...row})=>({...row,dialect:normalizeDialect(configured_dialect)||dialectDefault.dialect}))(rawSelected):null;
 const assignments=list.rows.map(({configured_dialect,...row})=>({...row,dialect:normalizeDialect(configured_dialect)||dialectDefault.dialect}));
 const [steps,events]=selected?await Promise.all([
  database().query(`SELECT s.sequence,s.profile_code,t.id AS task_id,t.status,t.attempt,t.claimed_at,t.finished_at,t.error_code,t.result,t.response_hash,
    t.prepared->'shared_context' AS shared_context FROM tanaghom.agency_workspace_steps s JOIN tanaghom.agency_pilot_tasks t ON t.id=s.task_id
    WHERE s.workspace_id=$1 AND t.organization_id=$2 ORDER BY s.sequence`,[selected.id,actor.organizationId]),
  database().query(`SELECT id,event_type,actor_kind,actor_ref,evidence,occurred_at FROM tanaghom.agency_workspace_events
    WHERE workspace_id=$1 AND organization_id=$2 ORDER BY id LIMIT 100`,[selected.id,actor.organizationId]),
 ]):[{rows:[]},{rows:[]}];
 const [quota,usage]=await Promise.all([loadWorkspaceQuota(database(),actor.organizationId),loadWorkspaceUsage(database(),actor.organizationId)]);
 const c=control.rows[0];const isConfigured=configured();
 // Never leak internal latch/reason strings to the customer. A failed model
 // task latches the control row; the UI receives calm, actionable copy instead.
 const runtimeReason=!isConfigured
  ?"AI drafting is in draft-save mode on this environment. You can create and save assignment briefs now; automated specialist generation will run once the model worker is active."
  :(!c?.enabled||c.emergency_stop)
   ?"AI specialist generation is temporarily paused. You can still create and save assignment briefs while generation resumes."
   :c.platform_stop
    ?"AI specialist generation is paused by the platform while operations are reviewed. Your briefs can still be saved."
    :"AI specialists are ready. Generated work stays as a reviewable proposal until a person approves it.";
 return {contract_version:workspaceManifest.contract_version,profiles:workspaceManifest.profiles.map(({instruction:_,...p})=>p),
  assignments,selected:selected?{...selected,steps:steps.rows,events:events.rows}:null,
  default_dialect:dialectDefault.dialect,default_dialect_source:dialectDefault.source,
  can_manage:actor.role==="owner",can_review:["owner","reviewer"].includes(actor.role),
  quota,usage,
  runtime:{ready:isConfigured&&c?.enabled&&!c.emergency_stop&&!c.platform_stop,
   reason:runtimeReason,
   provider:selectedProvider()==="gemini"?workspaceManifest.provider.name:"Gemma",model:selectedProvider()==="gemini"?workspaceManifest.provider.model:"gemma4-26b-a4b-canary",external_actions:false,quality_certified:false}};
}

const policy={business_timezone:"Asia/Amman",business_hours:[],allowed_channels:["instagram","facebook","linkedin","whatsapp"],
 consent_required:true,max_steps:1,max_tool_calls:0,max_retries:0,max_concurrency:1,max_runtime_seconds:180,max_tokens:1400,
 max_daily_actions:0,max_actions_per_minute:0,max_follow_ups_per_contact:0,monthly_budget:0,
 allowed_record_types:["campaign","content","conversation","report"],allowed_action_types:["proposal.create"],
 approval_actions:["provider.external_write"],approval_roles:["owner","reviewer"],approval_expiry_minutes:60,
 parameter_bound_approval:true,escalation_conditions:["Missing source facts require a human decision."]};

export async function workspaceWrite(request:NextRequest){
 enforceSameOriginForCookieMutation(request);
 const body=await boundedBody(request);
 const actor=await authorize(request,body.action==="approve"||body.action==="reject"?["owner","reviewer"]:["owner"]);
 if(body.action==="create"){
  closed(body,["action","title","brief","source_facts","language","profile","dialect","idempotency_key"]);
  for(const [key,min,max] of [["title",3,120],["brief",30,6000],["source_facts",20,6000]] as const)
   if(typeof body[key]!=="string"||body[key].trim().length<min||body[key].length>max)throw new WorkspaceError(`workspace_${key}_invalid`,400);
  if(!["en","ar"].includes(String(body.language)))throw new WorkspaceError("workspace_language_invalid",400);
  if(body.dialect!==undefined&&normalizeDialect(body.dialect)===null)throw new WorkspaceError("workspace_dialect_invalid",400);
  const profiles=body.profile==="team"?workspaceManifest.profiles.map(p=>p.code):[String(body.profile)];
  if(profiles.some(c=>!workspaceManifest.profiles.some(p=>p.code===c)))throw new WorkspaceError("workspace_profile_invalid",400);
  const r=await database().query("SELECT tanaghom.create_agency_workspace($1,$2,$3,$4,$5,$6,$7) AS id",
   [actor.id,String(body.title).trim(),String(body.brief).trim(),String(body.source_facts).trim(),body.language,profiles,identifier(body.idempotency_key)]);
  const id=r.rows[0].id;
  if(body.language==="ar"){
   const fallback=await defaultArabicDialect(actor.organizationId);
   const dialect=normalizeDialect(body.dialect)||fallback.dialect;
   await database().query(`INSERT INTO tanaghom.agent_actions_log
    (correlation_id,actor_user_id,action_type,entity_type,entity_id,organization_id,payload,result)
    SELECT $1,$2,'workspace.brief_configured','agency_workspace',$3,$4,$5::jsonb,'success'
    WHERE NOT EXISTS (SELECT 1 FROM tanaghom.agent_actions_log WHERE organization_id=$4
      AND action_type='workspace.brief_configured' AND entity_id=$3)`,
    [randomUUID(),actor.id,id,actor.organizationId,JSON.stringify({dialect})]);
  }
  return r.rows[0];
 }
 const id=identifier(body.id);
 if(body.action==="start"){
  closed(body,["action","id"]);if(!configured())throw new WorkspaceError("workspace_model_not_configured",503);
  const client=await database().connect();
  try{
   await client.query("BEGIN");
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`workspace-install:${actor.organizationId}`]);
   const w=(await client.query("SELECT profile_codes,status FROM tanaghom.agency_workspaces WHERE id=$1 AND organization_id=$2",[id,actor.organizationId])).rows[0];
   if(!w)throw new WorkspaceError("workspace_not_found",404);
   if(w.status!=="draft"){await client.query("COMMIT");return {id};}
   await requireWorkspaceQuota(client,actor.organizationId,id);
   const bindings:string[]=[];
   for(const code of w.profile_codes){
    const profile=workspaceManifest.profiles.find(p=>p.code===code)!;
    let version=(await client.query(`SELECT v.id FROM tanaghom.organization_agent_definitions d JOIN tanaghom.organization_agent_versions v ON v.agent_id=d.id
     WHERE d.organization_id=$1 AND d.code=$2 AND v.lifecycle_state IN ('validated','simulation') ORDER BY v.version_number DESC LIMIT 1`,[actor.organizationId,`workspace_${code}`])).rows[0]?.id;
    if(!version){
     const skill=code==="social_media_strategist"?"001":["discovery_coach","support_responder"].includes(code)?"006":"002";
     const parsed=parseOrganizationAgentDraft({code:`workspace_${code}`,template_code:null,display_name:profile.name,
      description:`Draft-only workspace specialist. ${profile.role}.`,objective:`Prepare a reviewable ${profile.deliverable.toLowerCase()}.`,
      responsibility:`Produce ${profile.deliverable.toLowerCase()} using the assignment source facts; no external actions.`,tone:"Clear, grounded and helpful",
      brand_profile_key:null,languages:["en","ar"],knowledge_keys:[],integrations:[],policy,
      skills:[{skill_source:"platform",skill_version_id:`72000000-0000-4000-8000-000000000${skill}`,operating_mode:"shadow",approval_required:true,constraints:{}}]});
     const {content_hash,clone_source_version_id:_,...payload}=parsed;
     version=(await client.query("SELECT * FROM tanaghom.create_organization_agent_draft($1,$2,$3,$4,NULL)",[actor.organizationId,actor.id,payload,content_hash])).rows[0].agent_version_id;
     await client.query("SELECT * FROM tanaghom.transition_organization_agent_version($1,$2,$3,'validate',$4)",[actor.organizationId,actor.id,version,agentValidationReport(parsed)]);
    }
    bindings.push((await client.query("SELECT tanaghom.bind_agency_pilot($1,$2,$3) AS id",[actor.id,version,code])).rows[0].id);
   }
   await client.query("SELECT tanaghom.start_agency_workspace($1,$2,$3,$4)",[actor.id,id,bindings,profileId()]);
   await client.query("COMMIT");return {id};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
 }
 if(body.action==="retry"){
  closed(body,["action","id"]);
  const client=await database().connect();
  try{
   await client.query("BEGIN");
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`workspace-install:${actor.organizationId}`]);
   const w=(await client.query("SELECT status FROM tanaghom.agency_workspaces WHERE id=$1 AND organization_id=$2",[id,actor.organizationId])).rows[0];
   if(!w)throw new WorkspaceError("workspace_not_found",404);
   if(w.status!=="failed")throw new WorkspaceError("workspace_not_retryable",409);
   await requireWorkspaceQuota(client,actor.organizationId,id);
   const r=await client.query("SELECT tanaghom.decide_agency_workspace($1,$2,$3,$4,$5) AS status",[actor.id,id,"retry",null,""]);
   await client.query("COMMIT");
   return {id,...r.rows[0]};
  }catch(error){await client.query("ROLLBACK");throw workspaceStateError(error)??error;}finally{client.release();}
 }
 closed(body,["action","id","result_hash","feedback"]);
 if(!["approve","reject","pause","resume","cancel"].includes(String(body.action)))throw new WorkspaceError("workspace_action_invalid",400);
 if(body.feedback!==undefined&&typeof body.feedback!=="string")throw new WorkspaceError("workspace_feedback_invalid",400);
 try{
  const r=await database().query("SELECT tanaghom.decide_agency_workspace($1,$2,$3,$4,$5) AS status",[actor.id,id,body.action,body.result_hash||null,body.feedback||""]);
  return {id,...r.rows[0]};
 }catch(error){throw workspaceStateError(error)??error;}
}

function workspaceDiagnostic(error:unknown){
 if(error instanceof GeminiWorkspaceError||error instanceof WorkspaceOutputError)return error.details??null;
 if(error instanceof Error&&["TimeoutError","AbortError"].includes(error.name))return {error_name:error.name,error_message:error.message.slice(0,300)};
 return null;
}

function workspaceFailure(error:unknown){
 if(error instanceof WorkspaceError)return error.code;
 if(error instanceof GeminiWorkspaceError)return error.code;
 const code=typeof error==="object"&&error!==null&&"code" in error?(error as {code?:unknown}).code:null;
 if(typeof code==="string"&&["provider_request_rejected","provider_quota_exceeded","output_rejected","model_unavailable","inference_failed","inference_outcome_unknown"].includes(code))return code;
 if(code==="workspace_language_mismatch")return "output_rejected";
 if(error instanceof Error&&["TimeoutError","AbortError"].includes(error.name))return "inference_outcome_unknown";
 return "output_rejected";
}

async function verifiedInventory(client:ReturnType<typeof createGeminiWorkspaceClient>,model:string,apiKey:string){
 const now=Date.now(),key=createHash("sha256").update(apiKey).digest("hex");
 if(inventoryCache&&inventoryCache.model===model&&inventoryCache.key===key&&inventoryCache.expires>now)return inventoryCache.value;
 const value=await client.inventory(model);
 inventoryCache={model,key,expires:now+600000,value};
 return value;
}

export async function workspaceTick(request:NextRequest){
 const expected=Buffer.from(process.env.AGENCY_WORKSPACE_WORKER_TOKEN||"");
 const actual=Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /,"")||"");
 if(expected.length<32||actual.length!==expected.length||!timingSafeEqual(expected,actual))throw new WorkspaceError("unauthorized",401);
 const body=await boundedBody(request);closed(body,["action"]);if(body.action!=="tick")throw new WorkspaceError("workspace_action_invalid",400);
 const apiKey=geminiApiKey();
 if(!configured())throw new WorkspaceError("workspace_model_not_configured",503);
 const pool=globalThis.tanaghomWorkspacePool??=new Pool({connectionString:process.env.AGENCY_WORKSPACE_DATABASE_URL,max:2,connectionTimeoutMillis:5000,application_name:"tanaghom-workspace-worker"});
 const availableModels:string[]=[];
 if(process.env.GEMMA_API_KEY?.trim())availableModels.push("7d000000-0000-4000-8000-000000000002");
 if(apiKey)availableModels.push("7d000000-0000-4000-8000-000000000003");
 const claimed=(await pool.query("SELECT tanaghom.claim_agency_workspace_task_for_models($1::uuid[]) AS task",[availableModels])).rows[0].task;
 if(!claimed)return {claimed:false};
 let task=claimed;
 if(task.language==="ar"){
  try{
   const context=(await database().query(`SELECT o.location,
    (SELECT l.payload->>'dialect' FROM tanaghom.agent_actions_log l WHERE l.organization_id=w.organization_id
      AND l.action_type='workspace.brief_configured' AND l.entity_id=w.id ORDER BY l.created_at DESC,l.id DESC LIMIT 1) AS brief_dialect,
    (SELECT v.rules->>'arabic_dialect' FROM tanaghom.brand_kits kit
      JOIN tanaghom.brand_kit_versions v ON v.kit_id=kit.id AND v.version=kit.current_version
      WHERE kit.organization_id=w.organization_id ORDER BY kit.created_at DESC,kit.id DESC LIMIT 1) AS brand_dialect
    FROM tanaghom.agency_workspace_steps s JOIN tanaghom.agency_workspaces w ON w.id=s.workspace_id
    JOIN tanaghom.organizations o ON o.id=w.organization_id WHERE s.task_id=$1`,[task.task_id])).rows[0];
   task={...task,dialect:resolveArabicDialect({campaignDialect:context?.brief_dialect,brandKitDialect:context?.brand_dialect,location:context?.location})};
  }catch{task={...task,dialect:"msa"};}
 }
 let artifact=null,errorCode:string|null=null,errorDetail:Record<string,unknown>|null=null;const started=Date.now();
 try{
  let output=null;
  const isGemma=task.model==="gemma4-26b-a4b-canary";
  const isGemini=task.model===workspaceManifest.provider.model;
  if(!isGemma&&!isGemini)throw new WorkspaceError("model_unavailable");
  if(task.profile!=="executive_summary"&&isGemma){
   if(!process.env.GEMMA_API_KEY?.trim())throw new WorkspaceError("model_unavailable");
   const authorization=`Bearer ${process.env.GEMMA_API_KEY}`;
   const inventory=await fetch("https://api.thesmartlabs.net/gemma4/v1/models",{headers:{authorization},redirect:"error",signal:AbortSignal.timeout(10000),cache:"no-store"});
   if(!inventory.ok)throw new WorkspaceError("model_unavailable");
   const models=await responseJson(inventory);const model=Array.isArray(models.data)?models.data.find((m:{id:string})=>m.id===task.model):null;
   if(!model||!Number.isInteger(model.max_model_len))throw new WorkspaceError("model_unavailable");
   const payload=legacy.workspaceRequest(task,model.max_model_len);
   const response=await fetch(legacy.modelEndpoint,{method:"POST",headers:{authorization,"content-type":"application/json"},body:JSON.stringify(payload),redirect:"error",signal:AbortSignal.timeout(legacy.workspaceManifest.timeout_ms),cache:"no-store"});
   if(!response.ok)throw new WorkspaceError("inference_failed");
   output=await responseJson(response);
  }else if(task.profile!=="executive_summary"){
   if(!apiKey)throw new WorkspaceError("model_unavailable");
   const client=createGeminiWorkspaceClient({apiKey,timeoutMs:130_000,attemptTimeoutMs:45_000});
   const inventory=await verifiedInventory(client,task.model,apiKey);
   if(inventory.id!==task.model)throw new WorkspaceError("model_unavailable");
   const payload=workspaceRequest(task,inventory.inputTokenLimit,inventory.outputTokenLimit);
   if(!payload)throw new WorkspaceError("output_rejected");
   output=await client.generate(task.model,payload);
  }
  artifact=isGemma?legacy.workspaceArtifact(task,output,Date.now()-started):workspaceArtifact(task,output,Date.now()-started);
 }catch(error){errorCode=workspaceFailure(error);errorDetail=workspaceDiagnostic(error);}
 const completed=(await pool.query("SELECT tanaghom.complete_agency_workspace_task($1,$2,$3,$4) AS result",[task.task_id,task.lease_token,artifact,errorCode])).rows[0].result;
 try{
  const context=(await database().query(`SELECT w.id AS workspace_id,w.organization_id,actor.id AS actor_user_id
   FROM tanaghom.agency_workspace_steps s JOIN tanaghom.agency_workspaces w ON w.id=s.workspace_id
   JOIN tanaghom.app_users actor ON actor.id=w.requested_by AND actor.organization_id=w.organization_id AND actor.is_active
   WHERE s.task_id=$1`,[task.task_id])).rows[0];
  if(context){
   if(errorCode&&errorDetail)await database().query(`INSERT INTO tanaghom.agency_pilot_events
    (organization_id,task_id,event_type,reference_id,evidence)
    SELECT $1,id,'failed',id,$3::jsonb FROM tanaghom.agency_pilot_tasks WHERE id=$2`,
    [context.organization_id,task.task_id,JSON.stringify({reason:errorCode,diagnostic:errorDetail,source:"workspace_tick"})]);
   await database().query(`INSERT INTO tanaghom.agent_actions_log
   (correlation_id,actor_user_id,action_type,entity_type,entity_id,organization_id,payload,result)
   VALUES($1,$2,$3,'agency_workspace',$4,$5,$6::jsonb,$7)`,[randomUUID(),context.actor_user_id,
   errorCode?"workspace.inference_failed":"workspace.inference_succeeded",context.workspace_id,context.organization_id,
   JSON.stringify({task_id:task.task_id,workspace_id:context.workspace_id,error_code:errorCode,diagnostic:errorDetail,usage:artifact?.usage||null,
    elapsed_ms:Date.now()-started,external_actions:0}),errorCode?"failed":"success"]);
  }
 }catch{/* completion is durable; audit transport must not redeliver it */}
 return {claimed:true,task_id:task.task_id,...completed};
}
