// Bounded regression receipts; fresh task-owned fixture for every suite.
// Historical exact-baseline harnesses run unchanged assertions via ephemeral
// migration-target-only siblings. Current-head SQL contracts run full 0046.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,unlinkSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
const directory=(process.env.P5_EVIDENCE_DIR??'evaluation/creative-talking-head-v1')+'/regression';mkdirSync(directory,{recursive:true});
const suites=[['contracts',null],['database','0034_agency_pilot_integration'],['foundation',null],['image',null],['design','0039_creative_design_render'],['motion','0040_creative_motion_render'],['video','0044_creative_video_lane'],['segmentation','0045_creative_segmentation']];
const selected=process.argv.slice(2);const receipts=[];
function cmd(program,args){const r=spawnSync(program,args,{encoding:'utf8'});if(r.status!==0)throw new Error(program+' '+r.stderr);return r.stdout.trim();}
for(const [suite,target] of suites.filter(([name])=>!selected.length||selected.includes(name))){
 const owner=randomUUID(),name='tanaghom-p5-reg-'+owner.slice(0,8);let container,temporary,db;
 const url='postgresql://postgres:p5-fixture-only@127.0.0.1:45448/p5_reg';
 const env={...process.env,DATABASE_TEST_URL:url,DATABASE_URL:url,DATABASE_MIGRATION_TARGET:target??'',CREATIVE_STORAGE_BACKEND:'local',CREATIVE_UPLOAD_DIR:process.env.P5_SCRATCH_DIR+'/reg-'+owner};
 try{
  container=cmd('docker',['run','-d','--name',name,'--label','tanaghom.task=240','--label','tanaghom.owner='+owner,'-e','POSTGRES_PASSWORD=p5-fixture-only','-e','POSTGRES_DB=p5_reg','-p','127.0.0.1:45448:5432','postgres:16-alpine']);
  let ready=false;for(let i=0;i<80;i++){if(spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','p5_reg']).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,250));}assert.ok(ready);
  if(suite==='contracts'){
   db=new pg.Client({connectionString:url});await db.connect();let log='';
   for(const f of readdirSync('packages/database/migrations').filter(f=>f.endsWith('.up.sql')).sort()){await db.query(readFileSync('packages/database/migrations/'+f,'utf8'));log+='PASS migration '+f+'\n';}
   for(const f of ['packages/database/seeds/staging.sql','packages/database/seeds/creative_templates.sql',...readdirSync('packages/database/tests').filter(f=>f.startsWith('creative_')&&f.endsWith('.sql')).sort((a,b)=>a==='creative_foundation.sql'?-1:b==='creative_foundation.sql'?1:a.localeCompare(b)).map(f=>'packages/database/tests/'+f)]){const result=spawnSync('psql',[url,'-X','-v','ON_ERROR_STOP=1',...(f.includes('/tests/')?['-c','BEGIN']:[]),'-f',f,...(f.includes('/tests/')?['-c','ROLLBACK']:[])],{encoding:'utf8'});log+=(result.stdout??'')+'\n'+(result.stderr??'');writeFileSync(directory+'/'+suite+'.log',log);assert.equal(result.status,0,'SQL '+f+' '+result.stderr);log+='PASS '+f+'\n';}
   writeFileSync(directory+'/'+suite+'.log',log);receipts.push({suite,exit:0,baseline:'0046_creative_talking_head',passes:log.split('\n').filter(x=>x.startsWith('PASS')).length});console.log('PASS '+suite);
  }else{
   let script=suite==='database'?'scripts/database-test.mjs':'scripts/creative-'+suite+'-integration.mjs';
   if(target&&suite!=='database'){
    const source=readFileSync(script,'utf8'),needle='env: { ...env, DATABASE_URL: databaseUrl }';assert.equal(source.split(needle).length,2,'one migrate environment');
    temporary='scripts/.tmp-p5-regression-'+owner+'.mjs';writeFileSync(temporary,source.replace(needle,'env: { ...env, DATABASE_URL: databaseUrl, DATABASE_MIGRATION_TARGET: '+JSON.stringify(target)+' }'),{flag:'wx'});script=temporary;
   }
   const result=spawnSync(process.execPath,[script,...(suite==='database'?[]:['--browser'])],{env,encoding:'utf8',maxBuffer:64*1024*1024,timeout:300000});
   writeFileSync(directory+'/'+suite+'.log',(result.stdout??'')+'\n'+(result.stderr??''));receipts.push({suite,exit:result.status,target,passes:(result.stdout??'').split('\n').filter(x=>x.startsWith('PASS')).length,error:result.error?.message??null});console.log((result.status===0?'PASS ':'FAIL ')+suite+' exit='+result.status);if(result.status!==0)process.exitCode=1;
  }
 }catch(e){console.error('FAIL '+suite+' '+e.message);receipts.push({suite,exit:1,error:e.message});process.exitCode=1;}
 finally{if(db)await db.end();if(temporary)unlinkSync(temporary);if(container){assert.equal(cmd('docker',['inspect','--format','{{index .Config.Labels "tanaghom.owner"}}',container]),owner);cmd('docker',['rm','-f',container]);assert.equal(spawnSync('docker',['inspect',container]).status,1);}}
 writeFileSync(directory+'/receipts'+(selected.length?'-'+selected.join('-'):'')+'.json',JSON.stringify({scope:'OFFLINE DISPOSABLE SOURCE ONLY',receipts},null,2));
}
