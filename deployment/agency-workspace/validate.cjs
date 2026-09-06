const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Client}=require('pg');
(async()=>{
 const client=new Client({connectionString:fs.readFileSync('/run/secrets/database_url','utf8').trim()});
 await client.connect();try{
  assert.equal((await client.query('SELECT current_user AS u')).rows[0].u,'tanaghom_api');
  // The deployment's administrator checks the migration ledger. The application
  // role intentionally has no permission to inspect public.schema_migrations.
  for(const table of ['agency_workspaces','agency_workspace_steps','agency_workspace_events','agency_workspace_control'])await client.query(`SELECT * FROM tanaghom.${table} LIMIT 0`);
  assert.equal((await client.query("SELECT has_function_privilege(current_user,'tanaghom.decide_agency_workspace(uuid,uuid,text,text,text)','EXECUTE') AS x")).rows[0].x,true);
 }finally{await client.end();}
 const worker=new Client({connectionString:fs.readFileSync('/run/secrets/workspace_database_url','utf8').trim()});
 await worker.connect();try{
  assert.equal((await worker.query('SELECT current_user AS u')).rows[0].u,'tanaghom_agency_pilot_worker');
  assert.equal((await worker.query("SELECT has_function_privilege(current_user,'tanaghom.decide_agency_workspace(uuid,uuid,text,text,text)','EXECUTE') AS x")).rows[0].x,false);
  assert.equal((await worker.query("SELECT has_table_privilege(current_user,'tanaghom.agency_workspaces','UPDATE') AS x")).rows[0].x,false);
  // Preflight must be stopped; this claim must return no task, never run Gemma.
  assert.equal((await worker.query('SELECT tanaghom.claim_agency_workspace_task() AS t')).rows[0].t,null);
 }finally{await worker.end();}
 console.log('Workspace API/worker DB boundary passed; no task claimed');
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1});
