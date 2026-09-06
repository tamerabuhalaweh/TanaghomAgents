import { execFileSync } from 'node:child_process';
import { readFileSync,readdirSync } from 'node:fs';
import { randomBytes,randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { fingerprint } from '../packages/agent-runtime/agency-pilot.mjs';
import { workspaceManifest,workspaceArtifact,workspaceRequest } from '../packages/agent-runtime/workspace.mjs';
import { workspaceBrowser } from './agency-workspace-browser.mjs';
const name=`tanaghom-workspace-test-${randomUUID().slice(0,8)}`;
const password=randomBytes(24).toString('hex');
const image='postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:8e6,...options});
let pool;let count=0;
const org='10000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000001',model='7d000000-0000-4000-8000-000000000002';
const query=(sql,args=[])=>pool.query(sql,args);
async function reject(label,sql,args=[]){await assert.rejects(()=>query(sql,args));count++;console.log(`PASS ${label}`);}
try{
 docker(['run','--detach','--name',name,'--label','tanaghom.scope=workspace-disposable','--memory','512m','--cpus','1','-e','POSTGRES_PASSWORD','-e','POSTGRES_DB=tanaghom_workspace_test','-p','127.0.0.1::5432',image],{env:{...process.env,POSTGRES_PASSWORD:password}});
 const port=JSON.parse(docker(['inspect',name]))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort;
 pool=new pg.Pool({host:'127.0.0.1',port:Number(port),database:'tanaghom_workspace_test',user:'postgres',password,max:4});
 for(let i=0;i<40;i++){try{await query('SELECT 1');break;}catch{await new Promise(r=>setTimeout(r,500));}}
 for(const f of readdirSync('packages/database/migrations').filter(f=>f.endsWith('.up.sql')).sort())await query(readFileSync(`packages/database/migrations/${f}`,'utf8'));
 await query(readFileSync('packages/database/migrations/0035_agency_workspace.down.sql','utf8'));
 await query(readFileSync('packages/database/migrations/0035_agency_workspace.up.sql','utf8'));count++;console.log('PASS all migrations and unused 0035 down/up');
 await query(readFileSync('packages/database/seeds/staging.sql','utf8'));
 const bindingIds=[];
 for(const p of workspaceManifest.profiles){
  const skill=p.code==='social_media_strategist'?'001':['discovery_coach','support_responder'].includes(p.code)?'006':'002';
  const payload={code:`workspace_${p.code}`,template_code:null,display_name:p.name,description:`Draft-only specialist for ${p.role}.`,objective:'Prepare grounded draft documents for human review.',responsibility:'Use approved source facts and never execute external actions.',tone:'Clear and grounded',brand_profile_key:null,languages:['en','ar'],knowledge_keys:[],integrations:[],
   skills:[{skill_source:'platform',skill_version_id:`72000000-0000-4000-8000-000000000${skill}`,operating_mode:'shadow',approval_required:true,constraints:{}}],
   policy:{business_timezone:'Asia/Amman',business_hours:[],allowed_channels:['instagram','whatsapp'],consent_required:true,max_steps:1,max_tool_calls:0,max_retries:0,max_concurrency:1,max_runtime_seconds:180,max_tokens:1400,max_daily_actions:0,max_actions_per_minute:0,max_follow_ups_per_contact:0,monthly_budget:0,allowed_record_types:['campaign','content','conversation','report'],allowed_action_types:['proposal.create'],approval_actions:['provider.external_write'],approval_roles:['owner','reviewer'],approval_expiry_minutes:60,parameter_bound_approval:true,escalation_conditions:['Missing facts require a human decision.']}};
  const v=(await query('SELECT * FROM tanaghom.create_organization_agent_draft($1,$2,$3,$4,NULL)',[org,owner,payload,fingerprint(payload)])).rows[0].agent_version_id;
  await query("SELECT * FROM tanaghom.transition_organization_agent_version($1,$2,$3,'validate',$4)",[org,owner,v,{valid:true,validator_version:'workspace-disposable.v1',runtime_certified:false}]);
  bindingIds.push((await query('SELECT tanaghom.bind_agency_pilot($1,$2,$3) AS id',[owner,v,p.code])).rows[0].id);
 }
 const codes=workspaceManifest.profiles.map(p=>p.code);
 const createSql='SELECT tanaghom.create_agency_workspace($1,$2,$3,$4,$5,$6,$7) AS id';
 const create=async(lang,profiles=codes,key=randomUUID())=>(await query(createSql,[owner,`Fictional ${lang} work pack`,'Prepare organic Instagram campaign drafts for a fictional photography course.','The fictional course teaches basic photography. No price or start date is confirmed.',lang,profiles,key])).rows[0].id;
 const key=randomUUID(),id=await create('en',codes,key);assert.equal(await create('en',codes,key),id);count++;console.log('PASS duplicate assignment returns same ID');
 await reject('changed payload same key rejected',createSql,[owner,'Different title','Prepare organic Instagram campaign drafts for a fictional course.','Only fictional facts are allowed in the test.','en',codes,key]);
 await reject('stop blocks start','SELECT tanaghom.start_agency_workspace($1,$2,$3,$4)',[owner,id,bindingIds,model]);
 await query("UPDATE tanaghom.agency_workspace_control SET enabled=true,emergency_stop=false,reason='Disposable test';UPDATE tanaghom.agent_runtime_controls SET emergency_stop=false;");
 await query('SELECT tanaghom.start_agency_workspace($1,$2,$3,$4)',[owner,id,bindingIds,model]);
 await query('SELECT tanaghom.start_agency_workspace($1,$2,$3,$4)',[owner,id,bindingIds,model]);
 assert.equal(Number((await query('SELECT count(*) FROM tanaghom.agency_workspace_steps WHERE workspace_id=$1',[id])).rows[0].count),6);count++;console.log('PASS duplicate start creates exactly six tasks');
 await query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=false,model_execution_enabled=true');
 assert.equal((await query('SELECT * FROM tanaghom.claim_agency_pilot()')).rowCount,0);count++;console.log('PASS frozen simulator cannot claim workspace lane');
 let generated=0;
 for(const lang of ['en','ar']){
  const wid=lang==='en'?id:await create('ar');if(lang==='ar')await query('SELECT tanaghom.start_agency_workspace($1,$2,$3,$4)',[owner,wid,bindingIds,model]);
  for(let i=0;i<6;i++){
   const task=(await query('SELECT tanaghom.claim_agency_workspace_task() AS task')).rows[0].task;
   assert.ok(task);assert.equal(task.profile,codes[i]);assert.equal(task.shared_context.length,i);
   assert.equal((await query('SELECT tanaghom.claim_agency_workspace_task() AS task')).rows[0].task,null);
   const response=task.profile==='executive_summary'?null:{model:task.model,choices:[{finish_reason:'stop',message:{content:lang==='ar'?'هذه مسودة تجريبية عن دورة التصوير. المعلومات غير المؤكدة تتطلب مراجعة بشرية.':'This is an authored test draft about the photography course. Unknown details require human review.'}}]};
   if(response){assert.ok(workspaceRequest(task,32768));generated++;}
   const artifact=workspaceArtifact(task,response,1);
   await query('SELECT tanaghom.complete_agency_workspace_task($1,$2,$3,NULL)',[task.task_id,task.lease_token,artifact]);
   assert.equal((await query('SELECT tanaghom.complete_agency_workspace_task($1,$2,$3,NULL) AS x',[task.task_id,task.lease_token,artifact])).rows[0].x.replay,true);
  }
  assert.equal((await query('SELECT status FROM tanaghom.agency_workspaces WHERE id=$1',[wid])).rows[0].status,'waiting_review');
  await reject('stale pack decision rejected','SELECT tanaghom.decide_agency_workspace($1,$2,\'approve\',$3,\'\')',[owner,wid,'wrong']);
  const h=(await query('SELECT tanaghom.agency_workspace_result_hash($1) AS h',[wid])).rows[0].h;
  await query('SELECT tanaghom.decide_agency_workspace($1,$2,$3,$4,$5)',[owner,wid,lang==='en'?'approve':'reject',h,lang==='en'?'Disposable test decision':'Please revise the tone.']);
  count++;console.log(`PASS ${lang}: six-step handoff, shared context, exact completion replay, human decision`);
 }
 await reject('used migration refuses destructive rollback',readFileSync('packages/database/migrations/0035_agency_workspace.down.sql','utf8'));
 await query('ROLLBACK');
 const paused=await create('en',['content_creator']);await query('SELECT tanaghom.start_agency_workspace($1,$2,$3,$4)',[owner,paused,[bindingIds[1]],model]);
 await query("SELECT tanaghom.decide_agency_workspace($1,$2,'pause',NULL,'')",[owner,paused]);assert.equal((await query('SELECT tanaghom.claim_agency_workspace_task() AS task')).rows[0].task,null);
 await query("SELECT tanaghom.decide_agency_workspace($1,$2,'resume',NULL,'')",[owner,paused]);
 const inFlight=(await query('SELECT tanaghom.claim_agency_workspace_task() AS task')).rows[0].task;assert.ok(inFlight);
 await query("SELECT tanaghom.decide_agency_workspace($1,$2,'cancel',NULL,'')",[owner,paused]);
 assert.equal((await query('SELECT emergency_stop FROM tanaghom.agency_workspace_control')).rows[0].emergency_stop,true);count++;console.log('PASS pause/resume/cancel; in-flight cancellation stops further inference');
 assert.equal((await query("SELECT has_table_privilege('tanaghom_agency_pilot_worker','tanaghom.agency_workspaces','UPDATE') AS can_write,has_function_privilege('tanaghom_agency_pilot_worker','tanaghom.decide_agency_workspace(uuid,uuid,text,text,text)','EXECUTE') AS can_approve")).rows[0].can_write,false);
 assert.equal((await query("SELECT has_function_privilege('tanaghom_agency_pilot_worker','tanaghom.decide_agency_workspace(uuid,uuid,text,text,text)','EXECUTE') AS x")).rows[0].x,false);count++;console.log('PASS worker cannot approve or directly write assignment state');
 await query("UPDATE tanaghom.agency_workspace_control SET emergency_stop=false");
 const expiring=await create('en',['content_creator']);await query('SELECT tanaghom.start_agency_workspace($1,$2,$3,$4)',[owner,expiring,[bindingIds[1]],model]);
 const lease=(await query('SELECT tanaghom.claim_agency_workspace_task() AS task')).rows[0].task;
 await query("UPDATE tanaghom.agency_pilot_tasks SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[lease.task_id]);
 assert.equal((await query('SELECT tanaghom.claim_agency_workspace_task() AS task')).rows[0].task,null);
 assert.equal((await query('SELECT status,error_code FROM tanaghom.agency_workspaces WHERE id=$1',[expiring])).rows[0].error_code,'inference_outcome_unknown');
 assert.equal((await query('SELECT emergency_stop FROM tanaghom.agency_workspace_control')).rows[0].emergency_stop,true);
 await reject('expired result cannot overwrite quarantined work','SELECT tanaghom.complete_agency_workspace_task($1,$2,NULL,$3)',[lease.task_id,lease.lease_token,'inference_failed']);
 count++;console.log('PASS expired inference is quarantined with evidence and no automatic retry');
 if(process.argv.includes('--browser')){
  await query(`ALTER ROLE tanaghom_api LOGIN PASSWORD '${password}';ALTER ROLE tanaghom_agency_pilot_worker LOGIN PASSWORD '${password}'`);
  await workspaceBrowser(pool,`postgresql://tanaghom_api:${password}@127.0.0.1:${port}/tanaghom_workspace_test`,`postgresql://tanaghom_agency_pilot_worker:${password}@127.0.0.1:${port}/tanaghom_workspace_test`);
 }
 console.log(JSON.stringify({checks:count,authored_model_responses:generated,real_model_calls:0,provider_actions:0,disposable:true}));
}finally{if(pool)await pool.end();const owned=JSON.parse(docker(['inspect',name]))[0];assert.equal(owned.Config.Labels['tanaghom.scope'],'workspace-disposable');docker(['rm','-f','-v',name]);}
