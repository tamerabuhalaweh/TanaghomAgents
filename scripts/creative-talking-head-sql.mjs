// Actual disposable PostgreSQL contract, never a live database.
import assert from 'node:assert/strict';
import pg from 'pg';
const url=process.env.DATABASE_TEST_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('disposable_database_required');
const db=new pg.Client({connectionString:url});await db.connect();
try{
 assert.equal((await db.query("SELECT to_regclass('tanaghom.creative_avatars')::text AS name")).rows[0].name,'tanaghom.creative_avatars');
 const flags=(await db.query('SELECT * FROM tanaghom.creative_presenter_controls')).rows[0];
 assert.equal(flags.talking_head_enabled,false);assert.equal(flags.lip_sync_enabled,false);assert.equal(flags.custom_avatar_enabled,false);
 for(const table of ['creative_avatars','creative_avatar_provider_bindings','creative_avatar_consents']){
  for(const permission of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) AS allowed',['tanaghom_creative_worker','tanaghom.'+table,permission])).rows[0].allowed,false);
 }
 console.log('PASS canonical schema + all flags OFF + 12 worker table denials');
}finally{await db.end();}
