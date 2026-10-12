// #242 only: explicit owned loopback PostgreSQL fixture, no provider calls.
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync} from 'node:fs';
const url=new URL(process.env.DATABASE_TEST_URL??'');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/smartlabs242');
const owner=process.env.SMARTLABS_LOCAL_FIXTURE_OWNER;
assert.match(owner??'',/^issue242-(?:foundation-)?[a-f0-9]{32}$/,'explicit owned fixture label required');
const db=new pg.Client({connectionString:url.href});await db.connect();
assert.equal((await db.query("SELECT shobj_description(oid,'pg_database') AS owner FROM pg_database WHERE datname=current_database()")).rows[0].owner,owner,'owned fixture DB marker must match');
const sql=name=>readFileSync(`packages/database/migrations/0047_smartlabs_audio.${name}.sql`,'utf8');
async function rejected(source,pattern){let error;try{await db.query(source);}catch(e){error=e;await db.query('ROLLBACK');}assert.ok(error,'migration must refuse unsafe state');assert.match(error.message,pattern);}
async function permissionRefusals(direction){
 const tables=(await db.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='tanaghom' AND c.relkind IN ('r','p') AND (left(c.relname,9)='creative_' OR c.relname IN ('brand_kits','brand_kit_versions')) ORDER BY c.relname")).rows.map(r=>r.relname);
 const mutations=[];
 for(const table of tables)for(const role of ['tanaghom_creative_worker','tanaghom_api']){
  for(const privilege of role==='tanaghom_api'?['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']:['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])mutations.push(`GRANT ${privilege} ON tanaghom.${table} TO ${role}`);
  for(const privilege of role==='tanaghom_api'?['INSERT','UPDATE','REFERENCES']:['SELECT','INSERT','UPDATE','REFERENCES'])mutations.push(`GRANT ${privilege} (${table.endsWith('_controls')?'singleton':'id'}) ON tanaghom.${table} TO ${role}`);
 }
 for(const role of ['tanaghom_creative_worker','tanaghom_api']){
  for(const attribute of ['SUPERUSER','CREATEROLE','CREATEDB','REPLICATION','BYPASSRLS','INHERIT'])mutations.push(`ALTER ROLE ${role} ${attribute}`);
  mutations.push(`GRANT CREATE ON SCHEMA tanaghom TO ${role}`);
 }
 mutations.push('GRANT tanaghom_api TO tanaghom_creative_worker','GRANT tanaghom_creative_worker TO tanaghom_api',
  'GRANT EXECUTE ON FUNCTION tanaghom.create_creative_asset_version(uuid,text,uuid,text,text,integer,integer,integer,bigint,text,text,text,jsonb,text,text,text) TO tanaghom_api',
  'REVOKE EXECUTE ON FUNCTION tanaghom.create_creative_asset_version(uuid,text,uuid,text,text,integer,integer,integer,bigint,text,text,text,jsonb,text,text,text) FROM tanaghom_creative_worker');
 const snapshot=async()=>JSON.stringify((await db.query(`SELECT jsonb_build_object('ledger',(SELECT jsonb_agg(version ORDER BY version) FROM public.schema_migrations),'tables',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relacl) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='tanaghom'),'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,p.proacl,pg_get_functiondef(p.oid)) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='tanaghom'),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r),'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m)) AS snapshot`)).rows[0]);
 const before=await snapshot();
 for(const mutation of mutations){
  await rejected('BEGIN;'+mutation+';'+sql(direction).replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,''),/0047 restricted role baseline/);
  assert.equal(await snapshot(),before,'refusal must roll back metadata: '+mutation);
 }
 assert.equal((await db.query("SELECT has_table_privilege('tanaghom_api','tanaghom.creative_jobs','SELECT') AS allowed")).rows[0].allowed,true);
 console.log(`PASS ${direction} restricted baseline matrix: tables=${tables.length} refused=${mutations.length}; role/column/table/destructive/membership/schema/function cases; metadata rollback and API SELECT preserved`);
}
try {
 if(process.argv.includes('--role-red')){
  await db.query('ALTER ROLE tanaghom_creative_worker SUPERUSER');
  try{await rejected(sql('up'),/0047 restricted role baseline/);}
  finally{
   if((await db.query("SELECT max(version) AS v FROM public.schema_migrations")).rows[0].v==='0047_smartlabs_audio')await db.query(sql('down'));
   await db.query('ALTER ROLE tanaghom_creative_worker NOSUPERUSER');
  }
  console.log('PASS refuses escalated worker role');
 }else{
  const historical=(await db.query('SELECT version FROM public.schema_migrations ORDER BY version')).rows.map(r=>r.version);
  assert.equal(historical.at(-1),'0046_creative_talking_head');
  await permissionRefusals('up');
  await db.query(sql('up'));
  await permissionRefusals('down');
  const full=(await db.query('SELECT version FROM public.schema_migrations ORDER BY version')).rows.map(r=>r.version);
  assert.deepEqual(full,[...historical,'0047_smartlabs_audio']);
  console.log('PASS full migration chain actual ledger count='+full.length+' latest='+full.at(-1));
  await rejected(sql('up'),/exact 0046 baseline/);
  await db.query(sql('down'));assert.deepEqual((await db.query('SELECT version FROM public.schema_migrations ORDER BY version')).rows.map(r=>r.version),historical);
  await rejected(sql('down'),/exact 0047 baseline/);
  await db.query(sql('up'));console.log('PASS unused down/up; repeated up and wrong-baseline down refused');
  // Seed synthetic old-format rows; compare the entire durable rows through down/up.
  await db.query(`INSERT INTO tanaghom.organizations(id,slug,name,is_active) VALUES('24200000-0000-4000-8000-000000000011','issue242-migration','Synthetic migration',true);
   INSERT INTO tanaghom.app_users(id,organization_id,email,display_name,kind,role,auth_subject,accepted_at) VALUES('24200000-0000-4000-8000-000000000012','24200000-0000-4000-8000-000000000011','migration242@example.test','Synthetic owner','human','owner','24200000-0000-4000-8000-000000000014',now());
   INSERT INTO tanaghom.creative_jobs(id,organization_id,requested_by,idempotency_key,input_hash,correlation_id,capability,lane,status,claimed_by,lease_expires_at) VALUES('24200000-0000-4000-8000-000000000013','24200000-0000-4000-8000-000000000011','24200000-0000-4000-8000-000000000012',gen_random_uuid(),'fixture-only',gen_random_uuid(),'voice','gpu_audio','running','issue242-migration-worker',now()+interval '5 minutes');`);
  const make=mime=>db.query("SELECT tanaghom.create_creative_asset_version('24200000-0000-4000-8000-000000000013','issue242-migration-worker',NULL,'Synthetic audio',$1,NULL,NULL,100,100,repeat('a',64),$2,NULL,'{\"fixture\":true}',NULL,NULL,'render') AS id",[mime,'t/24200000-0000-4000-8000-000000000011/voice/24200000-0000-4000-8000-000000000013/v1.'+(mime==='audio/wav'?'wav':'ogg')]);
  await db.query('SET ROLE tanaghom_creative_worker');await make('audio/wav');await db.query('RESET ROLE');
  const snapshot=async()=>JSON.stringify((await db.query(`SELECT jsonb_build_object('jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM tanaghom.creative_jobs j),'assets',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM tanaghom.creative_assets a),'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM tanaghom.creative_asset_versions v),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM tanaghom.creative_events e),'audit',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM tanaghom.agent_actions_log l)) AS snapshot`)).rows[0]);
  const before=await snapshot();await db.query(sql('down'));await db.query(sql('up'));assert.equal(await snapshot(),before);console.log('PASS populated prior-format rows/job/version/provenance preserved byte-equivalent JSON down/up');
  await db.query('SET ROLE tanaghom_creative_worker');await make('audio/ogg');await db.query('RESET ROLE');
  const used=await snapshot();await rejected(sql('down'),/audio versions retained/);assert.equal(await snapshot(),used);console.log('PASS used new-format down refuses with all rows unchanged');
  assert.equal((await db.query("SELECT max(version) AS v FROM public.schema_migrations")).rows[0].v,'0047_smartlabs_audio');
  console.log('PASS #242 migration verification');
 }
}finally{await db.end();}
