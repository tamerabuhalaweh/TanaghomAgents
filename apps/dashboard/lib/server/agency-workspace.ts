import "server-only";
import { timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import type { NextRequest } from "next/server";
import { authorize } from "@/lib/server/authorization";
import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { parseOrganizationAgentDraft, agentValidationReport } from "@/lib/server/agent-studio-validation";
const { workspaceManifest, workspaceRequest, workspaceArtifact, modelEndpoint }: typeof import("@tanaghom/agent-runtime/workspace")
 = process.getBuiltinModule("module").createRequire(`${process.cwd()}/package.json`)("@tanaghom/agent-runtime/workspace");

export class WorkspaceError extends Error { constructor(public code:string,public status=409) { super(code); } }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const profileId="7d000000-0000-4000-8000-000000000002";
const expectedModel="gemma4-26b-a4b-canary";
declare global { var tanaghomWorkspacePool:Pool|undefined; }
const configured=()=>process.env.AGENCY_WORKSPACE_ENABLED==="true" && Boolean(process.env.GEMMA_API_KEY?.trim()) && Boolean(process.env.AGENCY_WORKSPACE_DATABASE_URL) && (process.env.AGENCY_WORKSPACE_WORKER_TOKEN?.length||0)>=32;
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

export async function workspaceRead(request:NextRequest){
 const actor=await authorize(request,["owner","reviewer","operator","viewer"]);
 const requested=request.nextUrl.searchParams.get("id");if(requested)identifier(requested);
 const list=await database().query(`SELECT id,title,language,profile_codes,status,error_code,created_at,started_at,finished_at
  FROM tanaghom.agency_workspaces WHERE organization_id=$1 ORDER BY created_at DESC,id LIMIT 40`,[actor.organizationId]);
 const id=requested||list.rows[0]?.id;
 const [control,record]=await Promise.all([
  database().query(`SELECT enabled,emergency_stop,reason,(SELECT emergency_stop FROM tanaghom.agent_runtime_controls) AS platform_stop FROM tanaghom.agency_workspace_control`),
  id?database().query(`SELECT *,tanaghom.agency_workspace_result_hash(id) AS result_hash FROM tanaghom.agency_workspaces WHERE id=$1 AND organization_id=$2`,[id,actor.organizationId]):Promise.resolve({rows:[]}),
 ]);
 if(requested&&!record.rows[0])throw new WorkspaceError("workspace_not_found",404);
 const selected=record.rows[0]||null;
 const [steps,events]=selected?await Promise.all([
  database().query(`SELECT s.sequence,s.profile_code,t.id AS task_id,t.status,t.attempt,t.claimed_at,t.finished_at,t.error_code,t.result,t.response_hash,
    t.prepared->'shared_context' AS shared_context FROM tanaghom.agency_workspace_steps s JOIN tanaghom.agency_pilot_tasks t ON t.id=s.task_id
    WHERE s.workspace_id=$1 AND t.organization_id=$2 ORDER BY s.sequence`,[selected.id,actor.organizationId]),
  database().query(`SELECT id,event_type,actor_kind,actor_ref,evidence,occurred_at FROM tanaghom.agency_workspace_events
    WHERE workspace_id=$1 AND organization_id=$2 ORDER BY id LIMIT 100`,[selected.id,actor.organizationId]),
 ]):[{rows:[]},{rows:[]}];
 const c=control.rows[0];
 return {contract_version:workspaceManifest.contract_version,profiles:workspaceManifest.profiles.map(({instruction:_,...p})=>p),
  assignments:list.rows,selected:selected?{...selected,steps:steps.rows,events:events.rows}:null,
  can_manage:actor.role==="owner",can_review:["owner","reviewer"].includes(actor.role),
  runtime:{ready:configured()&&c?.enabled&&!c.emergency_stop&&!c.platform_stop,
   reason:!configured()?"The test model worker is not connected yet.":!c?.enabled||c.emergency_stop?c?.reason:c.platform_stop?"Platform emergency stop is active.":"Draft-only model worker configured. Real task results are shown below; no provider actions.",
   model:expectedModel,external_actions:false,quality_certified:false}};
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
  closed(body,["action","title","brief","source_facts","language","profile","idempotency_key"]);
  for(const [key,min,max] of [["title",3,120],["brief",30,6000],["source_facts",20,6000]] as const)
   if(typeof body[key]!=="string"||body[key].trim().length<min||body[key].length>max)throw new WorkspaceError(`workspace_${key}_invalid`,400);
  if(!["en","ar"].includes(String(body.language)))throw new WorkspaceError("workspace_language_invalid",400);
  const profiles=body.profile==="team"?workspaceManifest.profiles.map(p=>p.code):[String(body.profile)];
  if(profiles.some(c=>!workspaceManifest.profiles.some(p=>p.code===c)))throw new WorkspaceError("workspace_profile_invalid",400);
  const r=await database().query("SELECT tanaghom.create_agency_workspace($1,$2,$3,$4,$5,$6,$7) AS id",
   [actor.id,String(body.title).trim(),String(body.brief).trim(),String(body.source_facts).trim(),body.language,profiles,identifier(body.idempotency_key)]);
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
   await client.query("SELECT tanaghom.start_agency_workspace($1,$2,$3,$4)",[actor.id,id,bindings,profileId]);
   await client.query("COMMIT");return {id};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
 }
 closed(body,["action","id","result_hash","feedback"]);
 if(!["approve","reject","pause","resume","cancel"].includes(String(body.action)))throw new WorkspaceError("workspace_action_invalid",400);
 if(body.feedback!==undefined&&typeof body.feedback!=="string")throw new WorkspaceError("workspace_feedback_invalid",400);
 const r=await database().query("SELECT tanaghom.decide_agency_workspace($1,$2,$3,$4,$5) AS status",[actor.id,id,body.action,body.result_hash||null,body.feedback||""]);
 return {id,...r.rows[0]};
}

export async function workspaceTick(request:NextRequest){
 const expected=Buffer.from(process.env.AGENCY_WORKSPACE_WORKER_TOKEN||"");
 const actual=Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /,"")||"");
 if(expected.length<32||actual.length!==expected.length||!timingSafeEqual(expected,actual))throw new WorkspaceError("unauthorized",401);
 const body=await boundedBody(request);closed(body,["action"]);if(body.action!=="tick")throw new WorkspaceError("workspace_action_invalid",400);
 if(!configured())throw new WorkspaceError("workspace_model_not_configured",503);
 const pool=globalThis.tanaghomWorkspacePool??=new Pool({connectionString:process.env.AGENCY_WORKSPACE_DATABASE_URL,max:2,connectionTimeoutMillis:5000,application_name:"tanaghom-workspace-worker"});
 const task=(await pool.query("SELECT tanaghom.claim_agency_workspace_task() AS task")).rows[0].task;
 if(!task)return {claimed:false};
 let artifact=null,errorCode:string|null=null;const started=Date.now();
 try{
  let output=null;
  if(task.profile!=="executive_summary"){
   const authorization=`Bearer ${process.env.GEMMA_API_KEY}`;
   const inventory=await fetch("https://api.thesmartlabs.net/gemma4/v1/models",{headers:{authorization},redirect:"error",signal:AbortSignal.timeout(10000),cache:"no-store"});
   if(!inventory.ok)throw new WorkspaceError("model_unavailable");
   const models=await responseJson(inventory);const model=Array.isArray(models.data)?models.data.find((m:{id:string})=>m.id===expectedModel):null;
   if(!model||task.model!==expectedModel||!Number.isInteger(model.max_model_len))throw new WorkspaceError("model_unavailable");
   const payload=workspaceRequest(task,model.max_model_len);
   const response=await fetch(modelEndpoint,{method:"POST",headers:{authorization,"content-type":"application/json"},body:JSON.stringify(payload),
    redirect:"error",signal:AbortSignal.timeout(workspaceManifest.timeout_ms),cache:"no-store"});
   if(!response.ok)throw new WorkspaceError("inference_failed");
   output=await responseJson(response);
  }
  artifact=workspaceArtifact(task,output,Date.now()-started);
 }catch(error){errorCode=error instanceof WorkspaceError?error.code:error instanceof Error&&["TimeoutError","AbortError","TypeError"].includes(error.name)?"inference_outcome_unknown":"output_rejected";}
 const completed=(await pool.query("SELECT tanaghom.complete_agency_workspace_task($1,$2,$3,$4) AS result",[task.task_id,task.lease_token,artifact,errorCode])).rows[0].result;
 // n8n receives status only; artifacts remain in the application database.
 return {claimed:true,task_id:task.task_id,...completed};
}
