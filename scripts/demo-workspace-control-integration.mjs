import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

// Creates and removes only a uniquely named, labelled PostgreSQL test container.
const name=`tanaghom-control-test-${randomUUID().slice(0,8)}`;
const password=randomBytes(24).toString('hex');
const image='postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:8e6,...options});
const sql=readFileSync('deployment/dashboard-demo/sql/workspace-control.sql','utf8');
let pool, created=false;
const run=(action,id,db='tanaghom_demo',authorization='APPROVED-ISOLATED-DEMO-CONTROL')=>docker(['exec','-i',
 '-e',`DEMO_WORKSPACE_ACTION=${action}`,'-e',`DEMO_WORKSPACE_CHANGE_ID=${id}`,
 '-e',`DEMO_WORKSPACE_CONTROL_AUTHORIZATION=${authorization}`,name,'psql','-X','-U','postgres','-d',db],{input:sql,stdio:['pipe','pipe','pipe']});
try {
 docker(['run','--detach','--name',name,'--label','tanaghom.scope=demo-control-disposable','--memory','512m','--cpus','1',
  '-e','POSTGRES_PASSWORD','-e','POSTGRES_DB=tanaghom_demo','-p','127.0.0.1::5432',image],{env:{...process.env,POSTGRES_PASSWORD:password}});
 created=true;
 const port=JSON.parse(docker(['inspect',name]))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort;
 pool=new pg.Pool({host:'127.0.0.1',port:Number(port),database:'tanaghom_demo',user:'postgres',password,max:2});
 for(let i=0;i<40;i++){try{await pool.query('SELECT 1');break;}catch(error){if(i===39)throw error;await new Promise(r=>setTimeout(r,500));}}
 for(const f of readdirSync('packages/database/migrations').filter(f=>f.endsWith('.up.sql')).sort())
  await pool.query(readFileSync(`packages/database/migrations/${f}`,'utf8'));
 await pool.query(readFileSync('deployment/dashboard-demo/sql/demo_seed.sql','utf8'));
 const state=async()=> (await pool.query(`SELECT w.enabled,w.emergency_stop,r.emergency_stop AS platform_stop
  FROM tanaghom.agency_workspace_control w CROSS JOIN tanaghom.agent_runtime_controls r`)).rows[0];
 const stopped={enabled:false,emergency_stop:true,platform_stop:true};
 assert.deepEqual(await state(),stopped);
 assert.throws(()=>run('enable','bad-auth-001','tanaghom_demo','wrong'));
 assert.throws(()=>run('enable','wrong-db-001','postgres'));
 await pool.query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=false');
 assert.throws(()=>run('enable','pilot-open-001'));
 await pool.query('UPDATE tanaghom.agency_pilot_controls SET emergency_stop=true');
 await pool.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=false WHERE provider='postiz'");
 assert.throws(()=>run('enable','postiz-open-001'));
 await pool.query("UPDATE tanaghom.automation_platform_controls SET emergency_stop=true WHERE provider='postiz'");
 await pool.query('UPDATE tanaghom.agent_runtime_controls SET emergency_stop=false');
 assert.throws(()=>run('enable','platform-open-01'));
 await pool.query('UPDATE tanaghom.agent_runtime_controls SET emergency_stop=true');
 assert.deepEqual(await state(),stopped);
 run('enable','enable-test-001');
 assert.deepEqual(await state(),{enabled:true,emergency_stop:false,platform_stop:false});
 run('stop','stop-test-00001');
 assert.deepEqual(await state(),stopped);
 assert.throws(()=>run('enable','enable-test-001'));
 assert.deepEqual(await state(),stopped,'duplicate audit key rolls the whole switch transaction back');
 assert.equal(Number((await pool.query('SELECT count(*) FROM tanaghom.demo_workspace_control_audit')).rows[0].count),2);
 console.log('PASS isolated PostgreSQL 17: target, authorization, pilot/Postiz/platform stops, audited enable/stop and duplicate rollback');
} finally {
 if(pool)await pool.end();
 if(created){const owned=JSON.parse(docker(['inspect',name]))[0];
  assert.equal(owned.Config.Labels['tanaghom.scope'],'demo-control-disposable');docker(['rm','-f','-v',name]);}
}
