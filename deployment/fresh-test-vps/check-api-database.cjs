// Run inside a one-off dashboard container, before exposing the web service.
const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {Client}=createRequire('/app/apps/dashboard/server.js')('pg');
async function main(){
 const connectionString=readFileSync('/run/secrets/database_url','utf8').trim();
 const url=new URL(connectionString);
 assert.equal(url.protocol,'postgresql:');
 assert.equal(url.hostname,'postgres');
 assert.equal(url.port,'5432');
 assert.equal(url.pathname,'/tanaghom_test');
 assert.equal(url.username,'tanaghom_api');
 const client=new Client({connectionString,connectionTimeoutMillis:5000});
 try{
  await client.connect();
  const {rows:[row]}=await client.query('SELECT current_database() AS db,current_user AS role');
  assert.equal(row.db,'tanaghom_test');assert.equal(row.role,'tanaghom_api');
  const {rows:[owners]}=await client.query("SELECT count(*)::int AS count FROM tanaghom.app_users WHERE kind='human' AND role='owner' AND is_active AND accepted_at IS NOT NULL");
  assert.ok(owners.count>=1);
  console.log('RESTRICTED_API_DATABASE_AUTHENTICATION_PASSED');
 }finally{await client.end();}
}
main().catch(error=>{
 console.error(JSON.stringify({error:'restricted_api_database_check_failed',code:typeof error.code==='string'?error.code:'validation_failed'}));
 process.exitCode=1;
});
