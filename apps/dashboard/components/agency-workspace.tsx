"use client";

import { useCallback,useEffect,useRef,useState,type FormEvent } from "react";
import { ArrowRight,BookOpen,Check,ChevronRight,ClipboardList,Download,FileText,Pause,Play,Plus,RefreshCw,UsersRound,X } from "lucide-react";

type Profile={code:string;name:string;role:string;deliverable:string};
type Assignment={id:string;title:string;language:"en"|"ar";profile_codes:string[];status:string;error_code:string|null;created_at:string};
type Artifact={document:string;kind:string;model:string|null;context_hash:string;source_tasks:string[];procedure_version:string;elapsed_ms:number;usage:{total_tokens:number}|null};
type Step={sequence:number;profile_code:string;task_id:string;status:string;attempt:number;claimed_at:string|null;finished_at:string|null;error_code:string|null;result:Artifact|null;response_hash:string|null;shared_context:{profile:string;task_id:string;document:string;response_hash:string}[]|null};
type Event={id:number;event_type:string;actor_kind:string;actor_ref:string;evidence:{feedback?:string;sequence?:number;task_id?:string};occurred_at:string};
type Detail=Assignment&{brief:string;source_facts:string;result_hash:string;steps:Step[];events:Event[]};
type Data={profiles:Profile[];assignments:Assignment[];selected:Detail|null;can_manage:boolean;can_review:boolean;runtime:{ready:boolean;reason:string;model:string;quality_certified:boolean}};
const labels:Record<string,string>={draft:"Brief saved",queued:"Queued",running:"Working",paused:"Paused",waiting_review:"Ready for your review",approved:"Approved by human",rejected:"Changes requested",failed:"Needs attention",cancelled:"Cancelled",in_progress:"Working",succeeded:"Draft ready"};
const errorText:Record<string,string>={workspace_model_not_configured:"The model worker is not connected. Your brief is saved; no generation has started.",workspace_not_found:"This assignment was not found in your workspace.",workspace_brief_invalid:"Write a brief between 30 and 6,000 characters.",workspace_source_facts_invalid:"Add source facts between 20 and 6,000 characters.",workspace_title_invalid:"Use a title between 3 and 120 characters.",inference_outcome_unknown:"The model request did not finish with a confirmed result. Further inference is stopped for operator review.",output_rejected:"The result did not meet the document or context limits. Completed work is preserved; an operator must review the failure.",model_unavailable:"The configured Gemma connection or model identity could not be verified.",inference_failed:"Gemma rejected the request. No automatic retry was made.",workspace_cancelled:"This task was cancelled. Earlier completed work is preserved."};
const date=(value:string)=>new Date(value).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});

export function AgencyWorkspace(){
 const [data,setData]=useState<Data|null>(null);const [selectedId,setSelectedId]=useState<string|null>(null);
 const [selectedStep,setSelectedStep]=useState(1);const [tab,setTab]=useState<"deliverable"|"context"|"history">("deliverable");
 const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false);const [creating,setCreating]=useState(false);const [feedback,setFeedback]=useState("");
 const [profile,setProfile]=useState("team");const [language,setLanguage]=useState("en");
 const [title,setTitle]=useState("");const [brief,setBrief]=useState("");const [facts,setFacts]=useState("");
 const key=useRef<string|null>(null);const requestGeneration=useRef(0);const abort=useRef<AbortController|null>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const load=useCallback(async(id:string|null,quiet=false)=>{
  const generation=++requestGeneration.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;
  if(!quiet)setLoading(true);
  try{const r=await fetch(`/api/workspace${id?`?id=${encodeURIComponent(id)}`:""}`,{cache:"no-store",signal:controller.signal});
   if(r.status===401){window.location.assign("/login");return;}
   const result=await r.json();if(!r.ok)throw new Error(result.error||"request_failed");
   if(generation===requestGeneration.current){setData(result);setError("");}
  }catch(e){if(generation===requestGeneration.current&&!(e instanceof Error&&e.name==="AbortError"))setError(errorText[(e as Error).message]||"We could not load this workspace. Refresh to try again.");}
  finally{if(generation===requestGeneration.current)setLoading(false);}
 },[]);
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get("id");setSelectedId(id);},[]);
 useEffect(()=>{void load(selectedId);const interval=setInterval(()=>{if(!document.hidden)void load(selectedId,true);},5000);return()=>{clearInterval(interval);abort.current?.abort();};},[load,selectedId]);
 const selected=data?.selected;const step=selected?.steps.find(s=>s.sequence===selectedStep)||selected?.steps[0];
 useEffect(()=>{if(selected&&!['queued','running'].includes(selected.status))setNotice(n=>n.startsWith('Assignment queued.')?'':n);},[selected?.status,selected?.id]);
 const who=(code:string)=>data?.profiles.find(p=>p.code===code)?.name||code;
 function select(id:string){setSelectedId(id);setSelectedStep(1);setCreating(false);setNotice("");setFeedback("");window.history.replaceState(null,"",`/workspace?id=${id}`);}
 async function command(body:Record<string,unknown>){
  if(busy)return;setBusy(true);setError("");setNotice("");
  try{const r=await fetch("/api/workspace",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
   if(r.status===401){window.location.assign("/login");return;}
   const result=await r.json();if(!r.ok)throw new Error(result.error||"request_failed");
   if(body.action==="create"){key.current=null;select(result.id);setTitle("");setBrief("");setFacts("");setNotice("Brief saved. Review the shared facts, then start the assignment.");}
   else setNotice(body.action==="start"?"Assignment queued. Specialists will use your saved brief and hand their work to the next teammate.":body.action==="approve"?"Your approval has been recorded for this exact work pack. Nothing was published or sent.":body.action==="reject"?"Your feedback is saved. Create a revised assignment to produce a new version.":"Assignment state updated.");
   await load(result.id||selectedId,true);
  }catch(e){setError(errorText[(e as Error).message]||"The action was not accepted. Refresh to check the latest state; no approval is assumed.");}
  finally{setBusy(false);}
 }
 function create(event:FormEvent){event.preventDefault();key.current??=crypto.randomUUID();void command({action:"create",title,brief,source_facts:facts,language,profile,idempotency_key:key.current});}
 function newAssignment(){setCreating(true);setError("");setNotice("");key.current=null;setTimeout(()=>heading.current?.focus(),0);}
 function download(){if(!selected)return;const contents=`# ${selected.title}\n\nStatus: ${labels[selected.status]||selected.status}\n\n## Brief\n${selected.brief}\n\n## Owner-supplied source facts\n${selected.source_facts}\n\n`+selected.steps.filter(s=>s.result).map(s=>`## ${who(s.profile_code)}\nTask: ${s.task_id}\nVersion: ${s.response_hash}\n\n${s.result!.document}\n`).join("\n")+"\nDraft documents only. No external actions were performed.\n";
  const url=URL.createObjectURL(new Blob([contents],{type:"text/markdown;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`tanaghom-workpack-${selected.id}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <div className="agency-workspace">
  <header className="page-heading"><div><h1>AI workspace</h1><p>Give your specialists an outcome. Follow their work, shared context, and handoffs.</p></div>
   {data?.can_manage?<button className="button button-primary" onClick={newAssignment}><Plus size={18}/>New assignment</button>:null}</header>
  <div className="aw-boundary"><UsersRound size={18}/><span>Agency specialists · Draft-only workspace · Human review before use</span><span className={`aw-state ${data?.runtime.ready?"aw-state-ready":""}`}>{data?.runtime.ready?"Model worker configured":"Model connection pending"}</span></div>
  {error?<div className="aw-message aw-error" role="alert"><span>{error}</span><button className="button button-secondary" onClick={()=>void load(selectedId)}><RefreshCw size={16}/>Refresh</button></div>:null}
  {notice?<p className="aw-message" role="status">{notice}</p>:null}
  {loading&&!data?<div className="aw-loading" aria-busy="true" aria-label="Loading AI workspace"><div/><div/><div/></div>:null}
  {data?<>
   {!data.runtime.ready?<p className="aw-runtime-note">{data.runtime.reason} You can save an assignment now. No result is presented as model-generated until execution succeeds.</p>:null}
   <div className="aw-layout">
    <aside className="aw-assignments" aria-label="Assignments"><h2>Assignments <span>{data.assignments.length}</span></h2>
     {data.assignments.length?data.assignments.map(a=><button key={a.id} onClick={()=>select(a.id)} className={`aw-assignment ${selected?.id===a.id&&!creating?"aw-selected":""}`} aria-pressed={selected?.id===a.id&&!creating}>
      <strong>{a.title}</strong><span>{labels[a.status]||a.status}</span><small>{a.language==="ar"?"Arabic":"English"} · {a.profile_codes.length===1?"Specialist":"Team"} · {date(a.created_at)}</small></button>):<p className="aw-muted">Your saved briefs and completed work will stay here.</p>}
    </aside>
    <section className="aw-main">
     {creating?<form className="aw-create" onSubmit={create}>
      <header><h2 ref={heading} tabIndex={-1}>What should your team work on?</h2><p>Supply the outcome and facts once. Every specialist works from the same saved context.</p></header>
      <div className="aw-form-row"><label>Assignment title<input required minLength={3} maxLength={120} value={title} onChange={e=>{setTitle(e.target.value);key.current=null;}} placeholder="Summer course campaign work pack"/></label>
       <label>Output language<select value={language} onChange={e=>{setLanguage(e.target.value);key.current=null;}}><option value="en">English</option><option value="ar">العربية — Arabic</option></select></label></div>
      <label>Who should work on it?<select value={profile} onChange={e=>{setProfile(e.target.value);key.current=null;}}><option value="team">Campaign Work Pack — all six specialists</option>{data.profiles.map(p=><option key={p.code} value={p.code}>{p.name} — {p.deliverable}</option>)}</select></label>
      <div className="aw-team-preview" aria-label="Selected specialists">{data.profiles.filter(p=>profile==="team"||p.code===profile).map((p,i)=><span key={p.code}>{i>0?<ArrowRight size={14}/>:null}{p.name}</span>)}</div>
      <label>Task brief<textarea required minLength={30} maxLength={6000} rows={4} value={brief} onChange={e=>{setBrief(e.target.value);key.current=null;}} placeholder="Describe the audience, outcome, allowed channels, tone and deliverables. For example: prepare organic Instagram drafts for our course; no paid ads."/></label>
      <label>Shared source facts & brand guidance<textarea required minLength={20} maxLength={6000} rows={6} value={facts} onChange={e=>{setFacts(e.target.value);key.current=null;}} placeholder="Add the facts the team may rely on: what the offer includes, confirmed dates or prices, approved claims, brand tone, and what is unknown. Do not include passwords or customer-sensitive data."/></label>
      <p className="aw-muted">Source facts and the brief are saved as an immutable version. Earlier specialist outputs are shared as unapproved proposals—not new facts. No publishing, messaging, purchases or CRM updates.</p>
      <div className="aw-actions"><button type="submit" className="button button-primary" disabled={busy}>{busy?"Saving…":"Save assignment"}<ChevronRight size={17}/></button><button type="button" className="button button-secondary" onClick={()=>setCreating(false)} disabled={busy}>Cancel</button></div>
     </form>:selected?<>
      <header className="aw-assignment-header"><div><span className={`aw-state aw-state-${selected.status}`}>{labels[selected.status]}</span><h2>{selected.title}</h2><p>{selected.language==="ar"?"Arabic":"English"} · {selected.profile_codes.length} specialist{selected.profile_codes.length===1?"":"s"} · Created {date(selected.created_at)}</p></div>
       <div className="aw-actions">{selected.steps.some(s=>s.result)?<button className="button button-secondary" onClick={download}><Download size={16}/>Export pack</button>:null}
        {data.can_manage&&selected.status==="draft"?<button className="button button-primary" disabled={busy||!data.runtime.ready} onClick={()=>void command({action:"start",id:selected.id})}><Play size={16}/>{busy?"Starting…":"Start assignment"}</button>:null}
        {data.can_manage&&["queued","running"].includes(selected.status)?<button className="button button-secondary" disabled={busy} onClick={()=>void command({action:"pause",id:selected.id})}><Pause size={16}/>Pause</button>:null}
        {data.can_manage&&selected.status==="paused"?<button className="button button-primary" disabled={busy||!data.runtime.ready} onClick={()=>void command({action:"resume",id:selected.id})}><Play size={16}/>Resume</button>:null}
       </div></header>
      {selected.error_code?<p className="aw-message aw-error" role="alert">{errorText[selected.error_code]||"This assignment needs operator review. Completed artifacts are preserved."}</p>:null}
      {selected.status==="draft"?<section className="aw-brief"><h3>Shared assignment context</h3><p className="aw-prose" dir="auto">{selected.brief}</p><details open><summary><BookOpen size={16}/>Source facts & brand guidance</summary><p className="aw-prose" dir="auto">{selected.source_facts}</p></details>
       <h3>Your specialists</h3><ol className="aw-roster-preview">{selected.profile_codes.map(code=><li key={code}><strong>{who(code)}</strong><span>{data.profiles.find(p=>p.code===code)?.deliverable}</span></li>)}</ol></section>:<>
       <div className="aw-progress" aria-label="Task progress"><span>{selected.steps.filter(s=>s.status==="succeeded").length} of {selected.steps.length} deliverables ready</span><progress max={selected.steps.length||1} value={selected.steps.filter(s=>s.status==="succeeded").length}/><small>Recorded task state · refreshes every 5 seconds</small></div>
       <div className="aw-workbench"><nav className="aw-roster" aria-label="Specialist tasks">{selected.steps.map(s=><button key={s.task_id} onClick={()=>{setSelectedStep(s.sequence);setTab("deliverable");}} className={step?.task_id===s.task_id?"aw-selected":""} aria-pressed={step?.task_id===s.task_id}><span className={`aw-step-number aw-step-${s.status}`}>{s.status==="succeeded"?<Check size={16}/>:s.sequence}</span><span><strong>{who(s.profile_code)}</strong><small>{s.status==="queued"&&s.sequence>1?"Waiting for prior handoff":labels[s.status]||s.status}</small></span></button>)}</nav>
        <div className="aw-artifact-panel"><div className="aw-tabs" role="tablist" aria-label="Assignment detail" onKeyDown={event=>{const ids=['deliverable','context','history'] as const;const index=ids.indexOf(tab);const next=event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:event.key==='Home'?0:event.key==='End'?2:null;if(next!==null){event.preventDefault();setTab(ids[next]);document.getElementById(`aw-tab-${ids[next]}`)?.focus();}}}>{([ ["deliverable","Deliverable",FileText],["context","Shared context",BookOpen],["history","Activity",ClipboardList]] as const).map(([id,label,Icon])=><button key={id} role="tab" id={`aw-tab-${id}`} tabIndex={tab===id?0:-1} aria-selected={tab===id} aria-controls="aw-detail" onClick={()=>setTab(id)}><Icon size={16}/>{label}</button>)}</div>
         <section id="aw-detail" role="tabpanel" tabIndex={0} aria-labelledby={`aw-tab-${tab}`}>
          {tab==="deliverable"&&step?<><header className="aw-artifact-title"><h3>{data.profiles.find(p=>p.code===step.profile_code)?.deliverable}</h3><p>{who(step.profile_code)} · {labels[step.status]||step.status}</p></header>
           {step.result?<><article className="aw-document" dir={selected.language==="ar"?"rtl":"ltr"} lang={selected.language}>{step.result.document}</article><footer className="aw-artifact-meta"><span>{step.result.kind==="deterministic_summary"?"Deterministic delivery summary":`Generated by ${step.result.model}`}</span><span>{step.result.usage?`${step.result.usage.total_tokens.toLocaleString()} tokens`:"Token usage not reported"} · {(step.result.elapsed_ms/1000).toFixed(1)}s</span><details><summary>Version & source lineage</summary><p>Task: {step.task_id}</p><p>Result: {step.response_hash}</p><p>Procedure: {step.result.procedure_version}</p><p>Prior source tasks: {step.result.source_tasks.length}</p></details></footer></>:<div className="aw-task-empty"><FileText size={28}/><h3>{step.status==="in_progress"?"Your specialist is drafting":step.status==="failed"?"This task needs attention":"Waiting for its turn"}</h3><p>{step.status==="in_progress"?"The worker is using the saved brief and prior deliverables. The complete result will appear here when it has been stored.":step.status==="failed"?errorText[step.error_code||""]||"No successful result was recorded.":"This specialist starts after the preceding task has delivered its work. No activity is simulated."}</p></div>}
          </>:null}
          {tab==="context"?<div className="aw-context"><h3>The same brief, carried through the team</h3><p className="aw-muted">Owner-supplied facts remain separate from model proposals. These records belong only to this assignment.</p><details open><summary>Original brief</summary><p className="aw-prose" dir="auto">{selected.brief}</p></details><details open><summary>Owner-supplied source facts</summary><p className="aw-prose" dir="auto">{selected.source_facts}</p></details><h3>Deliverables passed to this specialist</h3>{step?.shared_context?.length?step.shared_context.map(m=><details key={m.task_id}><summary>{who(m.profile)} · unapproved proposal</summary><p className="aw-prose" dir="auto">{m.document}</p><small>Source task: {m.task_id}</small></details>):<p className="aw-muted">No prior deliverables were passed to this task. The first specialist works from the original brief.</p>}</div>:null}
          {tab==="history"?<ol className="aw-history">{selected.events.map(e=><li key={e.id}><span className="aw-event-dot"/><div><strong>{e.actor_kind==="worker"?who(e.actor_ref):"Human"} · {e.event_type.replaceAll("_"," ")}</strong><time dateTime={e.occurred_at}>{date(e.occurred_at)}</time>{e.evidence.feedback?<p>{e.evidence.feedback}</p>:null}{e.evidence.sequence?<p>Task {e.evidence.sequence} claimed with the shared assignment context.</p>:null}</div></li>)}</ol>:null}
         </section>
        </div>
       </div>
      </>}
      {selected.status==="waiting_review"?<section className="aw-review"><h3>Your decision completes this assignment</h3><p>Review every deliverable above. Approval records acceptance of this exact pack only—it does not publish content, send messages, or approve missing business facts.</p>{data.can_review?<><label>Review feedback<textarea rows={3} maxLength={2000} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="Required when requesting changes; optional when approving."/></label><div className="aw-actions"><button className="button button-primary" disabled={busy} onClick={()=>void command({action:"approve",id:selected.id,result_hash:selected.result_hash,feedback})}><Check size={17}/>Approve work pack</button><button className="button button-secondary" disabled={busy||feedback.trim().length<3} onClick={()=>void command({action:"reject",id:selected.id,result_hash:selected.result_hash,feedback})}><X size={17}/>Request changes</button></div></>:<p>An owner or reviewer must make this decision.</p>}</section>:null}
      {data.can_manage&&!['approved','rejected','cancelled'].includes(selected.status)?<details className="aw-cancel"><summary>Assignment controls</summary><p>Cancel remaining work while preserving completed documents and history. A request already reaching Gemma may still finish remotely.</p><button className="button button-secondary" disabled={busy} onClick={()=>void command({action:"cancel",id:selected.id})}>Cancel remaining work</button></details>:null}
     </>:<section className="aw-welcome"><UsersRound size={32}/><h2>A working team starts with a clear brief.</h2><p>Choose the Campaign Work Pack to hand an assignment through strategy, content, brand review, discovery, support, and a delivery summary. Or select one specialist for a focused task.</p><p>Each result stays attached to its task. You can inspect what was shared, export the work, and make the final decision.</p>{data.can_manage?<button className="button button-primary" onClick={newAssignment}><Plus size={17}/>Create your first assignment</button>:<p>Ask an owner to create an assignment.</p>}</section>}
    </section>
   </div>
  </>:null}
 </div>;
}
