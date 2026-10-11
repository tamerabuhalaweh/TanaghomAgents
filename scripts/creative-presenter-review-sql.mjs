// Review D1/D2 oracle. Disposable admin bootstrap; actual restricted roles.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
const url=process.env.DATABASE_TEST_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('disposable_database_required');
const db=new pg.Client({connectionString:url});await db.connect();
const failures=[];
async function check(name,run){try{await run();console.log('PASS '+name);}catch(e){failures.push(name);console.log('FAIL '+name+' '+e.message);}}
try{
 for(const table of ['creative_avatars','creative_avatar_provider_bindings','creative_avatar_consents','creative_presenter_controls'])for(const permission of ['SELECT','INSERT','UPDATE','DELETE'])await check('D1 API direct '+permission+' denied '+table,async()=>{await db.query('SET ROLE tanaghom_api');try{const sql={SELECT:`SELECT * FROM tanaghom.${table}`,INSERT:`INSERT INTO tanaghom.${table} DEFAULT VALUES`,UPDATE:`UPDATE tanaghom.${table} SET ${table==='creative_presenter_controls'?'talking_head_enabled=talking_head_enabled':table==='creative_avatar_consents'?'consent_status=consent_status':'status=status'} WHERE false`,DELETE:`DELETE FROM tanaghom.${table} WHERE false`}[permission];await assert.rejects(()=>db.query(sql),e=>e.code==='42501');}finally{await db.query('RESET ROLE');}});
 for(const fn of ['authorize_creative_presenter(uuid,uuid,uuid,text)','validate_creative_presenter_params(uuid,jsonb)'])await check('D1 API EXECUTE '+fn,async()=>assert.equal((await db.query("SELECT has_function_privilege('tanaghom_api',$1,'EXECUTE') yes",['tanaghom.'+fn])).rows[0].yes,true));
 for(const table of ['creative_avatars','creative_avatar_provider_bindings','creative_avatar_consents','creative_presenter_controls'])for(const permission of ['SELECT','INSERT','UPDATE','DELETE'])await check('D1 worker '+permission+' denied '+table,async()=>{await db.query('SET ROLE tanaghom_creative_worker');try{const sql={SELECT:`SELECT * FROM tanaghom.${table}`,INSERT:`INSERT INTO tanaghom.${table} DEFAULT VALUES`,UPDATE:`UPDATE tanaghom.${table} SET ${table==='creative_presenter_controls'?'talking_head_enabled=talking_head_enabled':'id=id'} WHERE false`,DELETE:`DELETE FROM tanaghom.${table} WHERE false`}[permission];await assert.rejects(()=>db.query(sql),e=>e.code==='42501');}finally{await db.query('RESET ROLE');}});
 // All fixture writes rolled back; no fixture identity remains for E2E.
 await db.query('BEGIN');
 const org=randomUUID(),actor=randomUUID();
 await db.query("INSERT INTO tanaghom.organizations(id,slug,name,is_active) VALUES($1,$2,'Review fixture',true)",[org,'review-'+org]);
 await db.query("INSERT INTO tanaghom.app_users(id,organization_id,email,display_name,kind,role,auth_subject,accepted_at) VALUES($1,$2,$3,'Review owner','human','owner',$4,now())",[actor,org,actor+'@fixture.invalid',randomUUID()]);
 await db.query('UPDATE tanaghom.creative_controls SET enabled=true,emergency_stop=false');await db.query('UPDATE tanaghom.creative_presenter_controls SET talking_head_enabled=true');
 const apiQuery=async(sql,args)=>{await db.query('SAVEPOINT api_call');await db.query('SET LOCAL ROLE tanaghom_api');try{const value=await db.query(sql,args);await db.query('RESET ROLE');return value;}catch(e){await db.query('ROLLBACK TO SAVEPOINT api_call');await db.query('RESET ROLE');throw e;}};
 await check('D1 controlled API catalog/create/binding/status and actor-denial readback',async()=>{
  const made=(await apiQuery("SELECT tanaghom.manage_creative_presenter($1,'create_avatar',$2,false) id",[actor,{name:'Controlled stock',avatar_type:'provider_stock'}])).rows[0].id;
  const bound=(await apiQuery("SELECT tanaghom.manage_creative_presenter($1,'add_binding',$2,false) id",[actor,{avatar_id:made,provider:'sync',provider_avatar_id:'controlled-visual',policy_approved:true}])).rows[0].id;
  await apiQuery("SELECT tanaghom.manage_creative_presenter($1,'set_avatar_status',$2,false)",[actor,{id:made,status:'active'}]);
  await apiQuery("SELECT tanaghom.manage_creative_presenter($1,'set_binding_status',$2,false)",[actor,{id:bound,status:'blocked'}]);
  const catalog=(await apiQuery('SELECT tanaghom.read_creative_presenter_catalog($1) value',[actor])).rows[0].value;
  const row=catalog.avatars.find(a=>a.id===made);assert.equal(row.status,'active');assert.equal(row.binding_status,'blocked');assert.equal(row.provider,'sync');assert.equal(row.model,'lipsync-2');
  await assert.rejects(()=>apiQuery('SELECT tanaghom.read_creative_presenter_catalog($1)',[randomUUID()]),e=>e.code==='P0001');
  for(const role of ['operator','reviewer','viewer']){const id=randomUUID();await db.query("INSERT INTO tanaghom.app_users(id,organization_id,email,display_name,kind,role,auth_subject,accepted_at) VALUES($1,$2,$3,'Review nonowner','human',$4,$5,now())",[id,org,id+'@fixture.invalid',role,randomUUID()]);await apiQuery('SELECT tanaghom.read_creative_presenter_catalog($1)',[id]);await assert.rejects(()=>apiQuery("SELECT tanaghom.manage_creative_presenter($1,'create_avatar',$2,false)",[id,{name:'Denied',avatar_type:'provider_stock'}]),e=>e.code==='P0001');}
 });
 const avatar=(await db.query("INSERT INTO tanaghom.creative_avatars(organization_id,name,avatar_type,status,created_by) VALUES($1,'Review stock','provider_stock','active',$2) RETURNING id",[org,actor])).rows[0].id;
 const binding=(await db.query("INSERT INTO tanaghom.creative_avatar_provider_bindings(organization_id,avatar_id,provider,provider_avatar_id,model,model_version,status,metadata) VALUES($1,$2,'heygen','look','avatar_iv','v3','active',$3) RETURNING id",[org,avatar,{policy_approved:true,voice_id:'voice',supported_api_engines:['avatar_iv']}])).rows[0].id;
 const script='Review',params={operation:'talking_head',avatar_id:avatar,binding_id:binding,script,script_hash:createHash('sha256').update(script).digest('hex'),script_length:script.length,locale:'en',ratio:'16:9',duration:5};
 for(const [provider,model,version,op] of [['heygen','avatar_iv','v2','talking_head'],['sync','lipsync-2','v1','lip_sync'],['sync','unapproved','v2','lip_sync']])await check('D2 denied unapproved binding product '+provider+'/'+model+'/'+version,async()=>{const bad=(await db.query("INSERT INTO tanaghom.creative_avatar_provider_bindings(organization_id,avatar_id,provider,provider_avatar_id,model,model_version,status,metadata) VALUES($1,$2,$3,'bad-product',$4,$5,'active',$6) RETURNING id",[org,avatar,provider,model,version,{policy_approved:true,voice_id:'voice',supported_api_engines:['avatar_iv']}])).rows[0].id;await assert.rejects(()=>apiQuery('SELECT tanaghom.authorize_creative_presenter($1,$2,$3,$4)',[org,avatar,bad,op]),e=>e.code==='P0001');});
 for(const [name,provider,model,version] of [['spoof-provider','synthesia','avatar_iv','v3'],['spoof-model','heygen','unapproved','v3'],['spoof-version','heygen','avatar_iv','v2'],['missing-version','heygen','avatar_iv',null],['positive-binding','heygen','avatar_iv','v3']])await check('D2 '+name,async()=>{
  const job=(await db.query("SELECT tanaghom.create_creative_job($1,'talking_head','gpu_video',$2,$3,$4) id",[actor,params,randomUUID(),randomUUID()])).rows[0].id;
  await db.query("UPDATE tanaghom.creative_jobs SET status='claimed',claimed_by='review-worker' WHERE id=$1",[job]);
  await db.query('SAVEPOINT attempt');await db.query('SET LOCAL ROLE tanaghom_creative_worker');
  let error,call;try{call=(await db.query("SELECT tanaghom.begin_creative_provider_call($1,'review-worker',$2,$3,$4,'talking_head','{}',NULL,'review') id",[job,provider,model,version])).rows[0].id;}catch(e){error=e;await db.query('ROLLBACK TO SAVEPOINT attempt');}finally{await db.query('RESET ROLE');}
  const rows=(await db.query('SELECT provider,model,model_version,units FROM tanaghom.creative_provider_calls WHERE job_id=$1',[job])).rows;
  if(name==='positive-binding'){assert.ifError(error);assert.ok(call);assert.deepEqual(rows,[{provider:'heygen',model:'avatar_iv',model_version:'v3',units:{avatar_id:avatar,binding_id:binding,provider_avatar_id:'look',consent_id:null}}]);}else{assert.equal(error?.code,'P0001','must deny spoof at SQL boundary');assert.equal(rows.length,0,'zero ledger append');}
 });
 await db.query('ROLLBACK');
 assert.deepEqual(failures,[],'all review SQL oracles must pass');
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
