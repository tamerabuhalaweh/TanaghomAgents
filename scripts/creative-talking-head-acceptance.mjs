// Fresh task-owned disposable PostgreSQL for every P5 acceptance run.
// Never loads .env files; removes only the exact container it created.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import pg from 'pg';
const runId=randomUUID(),name='tanaghom-p5-240-'+runId.slice(0,8);
const directory=(process.env.P5_EVIDENCE_DIR??'evaluation/creative-talking-head-v1')+'/runs/'+runId;
mkdirSync(directory,{recursive:true});
let container,db;const receipts=[];
function command(program,args,env=process.env){
 const result=spawnSync(program,args,{env,encoding:'utf8',maxBuffer:32*1024*1024,timeout:30000});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(program+' exit '+result.status+'\n'+result.stdout+'\n'+result.stderr);
 return result.stdout.trim();
}
async function sql(label,text){await db.query(text);receipts.push({gate:label,exit:0});console.log('PASS '+label);}
const url='postgresql://postgres:p5-fixture-only@127.0.0.1:45447/p5_240';
const roleUrl=role=>{const u=new URL(url);u.username=role;u.password=role==='tanaghom_api'?'p5-api-fixture-only':'p5-worker-fixture-only';return u.toString();};
const env={...process.env,DATABASE_URL:url,DATABASE_TEST_URL:url,P5_API_DATABASE_URL:roleUrl('tanaghom_api'),P5_WORKER_DATABASE_URL:roleUrl('tanaghom_creative_worker'),P5_SCRATCH_DIR:process.env.P5_SCRATCH_DIR,DATABASE_MIGRATION_TARGET:''};
if(!env.P5_SCRATCH_DIR)throw new Error('P5_SCRATCH_DIR required');
try{
 container=command('docker',['run','-d','--name',name,'--label','tanaghom.task=240','--label','tanaghom.owner='+runId,'-e','POSTGRES_PASSWORD=p5-fixture-only','-e','POSTGRES_DB=p5_240','-p','127.0.0.1:45447:5432','postgres:16-alpine']);
 let ready=false;for(let i=0;i<60;i++){const probe=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','p5_240']);if(probe.status===0){ready=true;break;}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'owned fixture PostgreSQL ready');
 db=new pg.Client({connectionString:url});await db.connect();
 for(const file of readdirSync('packages/database/migrations').filter(f=>f.endsWith('.up.sql')).sort())await sql('migration '+file,readFileSync('packages/database/migrations/'+file,'utf8'));
 assert.equal((await db.query('SELECT max(version) v FROM public.schema_migrations')).rows[0].v,'0046_creative_talking_head');
 await sql('0046 down unused schema',readFileSync('packages/database/migrations/0046_creative_talking_head.down.sql','utf8'));
 assert.equal((await db.query("SELECT to_regclass('tanaghom.creative_avatars') v")).rows[0].v,null);
 assert.equal((await db.query('SELECT max(version) v FROM public.schema_migrations')).rows[0].v,'0045_creative_segmentation');
 await sql('0046 up again',readFileSync('packages/database/migrations/0046_creative_talking_head.up.sql','utf8'));
 await db.query("ALTER ROLE tanaghom_api LOGIN PASSWORD 'p5-api-fixture-only'; ALTER ROLE tanaghom_creative_worker LOGIN PASSWORD 'p5-worker-fixture-only'");
 for(const role of ['tanaghom_api','tanaghom_creative_worker']){const restricted=new pg.Client({connectionString:roleUrl(role)});await restricted.connect();try{assert.deepEqual((await restricted.query('SELECT current_user AS role,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user')).rows[0],{role,rolsuper:false,rolcreaterole:false,rolcreatedb:false});}finally{await restricted.end();}}
 for(const script of ['creative-presenter-review-sql.mjs','creative-talking-head-sql.mjs','creative-talking-head-integration.mjs']){
  const args=['scripts/'+script,...(script.includes('integration')&&process.argv.includes('--browser')?['--browser']:[])];
  const result=spawnSync(process.execPath,args,{env,encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000});
  writeFileSync(directory+'/'+script+'.log',result.stdout+'\n'+result.stderr);console.log(result.stdout);
  receipts.push({gate:script,exit:result.status});assert.equal(result.status,0,result.stderr);
 }
 // Exercise rollback with real P5 history; retain vocabulary and exact rows.
 const tables=['creative_avatars','creative_avatar_provider_bindings','creative_avatar_consents','creative_jobs','creative_assets','creative_asset_versions','creative_provider_calls'];
 const snapshot=async()=>JSON.stringify(await Promise.all(tables.map(async table=>(await db.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) rows FROM tanaghom.${table} t`)).rows)));
 const before=await snapshot();
 writeFileSync(directory+'/used-state-before.json',before);
 await sql('0046 down with used P5 state',readFileSync('packages/database/migrations/0046_creative_talking_head.down.sql','utf8'));
 const afterDown=await snapshot();writeFileSync(directory+'/used-state-after-down.json',afterDown);
 assert.equal(afterDown,before);assert.equal((await db.query('SELECT max(version) v FROM public.schema_migrations')).rows[0].v,'0045_creative_segmentation');
 const check=(await db.query("SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='creative_provider_calls_operation_check'")).rows[0].d;assert.match(check,/lip_sync/);
 await sql('0046 re-up with used P5 state',readFileSync('packages/database/migrations/0046_creative_talking_head.up.sql','utf8'));
 const afterUp=await snapshot();writeFileSync(directory+'/used-state-after-up.json',afterUp);
 const flags=(await db.query('SELECT talking_head_enabled,lip_sync_enabled,custom_avatar_enabled FROM tanaghom.creative_presenter_controls')).rows[0];
 writeFileSync(directory+'/flags-after-up.json',JSON.stringify(flags,null,2));
 assert.equal(afterUp,before);assert.deepEqual(flags,{talking_head_enabled:false,lip_sync_enabled:false,custom_avatar_enabled:false});
 receipts.push({gate:'0046 used history identical, vocabulary retained, re-up flags OFF',exit:0});console.log('PASS 0046 used history identical, vocabulary retained, re-up flags OFF');
}catch(error){receipts.push({gate:'acceptance',exit:1,error:error.message});console.error(error);process.exitCode=1;}
finally{
 if(db)await db.end();
 if(container){assert.equal(command('docker',['inspect','--format','{{index .Config.Labels "tanaghom.owner"}}',container]),runId);command('docker',['rm','-f',container]);assert.equal(spawnSync('docker',['inspect',container]).status,1);console.log('PASS exact task-owned container cleanup');}
 writeFileSync(directory+'/runner.json',JSON.stringify({run_id:runId,container_id:container,scope:'DISPOSABLE SOURCE ONLY',receipts},null,2));
 console.log('RUN_RECEIPT '+directory+'/runner.json');
}
