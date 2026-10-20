// Bounded invocation on existing gpu_video queue; all features default OFF.
// Real execution needs separate explicit acceptance; this task grants none.
import pg from 'pg';
import {createHeyGenAdapter} from '../packages/creative-runtime/adapters/heygen.mjs';
import {createSyncAdapter} from '../packages/creative-runtime/adapters/sync.mjs';
import {claimPresenterJob,executePresenterJob} from '../packages/creative-runtime/render/presenter-worker.mjs';
import {createCreativeStorage} from '../packages/creative-runtime/storage/factory.mjs';
import {downloadArtifact} from '../packages/creative-runtime/adapters/http-image.mjs';
if(process.env.CREATIVE_PROVIDER_EXECUTION_AUTHORIZED!=='true')throw new Error('provider_execution_not_authorized');
const args=new Map(process.argv.slice(2).map(x=>{const m=/^--([a-z-]+)=(.*)$/.exec(x);if(!m)throw new Error('invalid_runner_argument');return [m[1],m[2]];}));
if([...args.keys()].some(k=>!['operation','worker','resume-job'].includes(k)))throw new Error('invalid_runner_argument');
const operation=args.get('operation');if(!['talking_head','lip_sync'].includes(operation))throw new Error('invalid_operation');
const enabled=process.env[operation==='talking_head'?'TALKING_HEAD_ENABLED':'LIP_SYNC_ENABLED']==='true';if(!enabled)throw new Error('presenter_worker_disabled');
if(!process.env.DATABASE_URL||!process.env.CREATIVE_STORAGE_BACKEND)throw new Error('private_runtime_configuration_required');
const worker=args.get('worker')??`presenter-${operation}-${process.pid}`;
if(!worker||worker.length>200||(args.has('resume-job')&&!args.has('worker')))throw new Error('explicit_original_worker_required_for_resume');
// Exact origin list must be separately verified; never infer CDN suffixes.
const origins=JSON.parse(process.env.CREATIVE_PRESENTER_ARTIFACT_ORIGINS??'[]');
if(!Array.isArray(origins)||!origins.length||origins.some(o=>new URL(o).origin!==o||new URL(o).protocol!=='https:'))throw new Error('approved_artifact_origins_required');
const provider=operation==='talking_head'?createHeyGenAdapter({apiKey:process.env.HEYGEN_API_KEY,artifactOrigins:origins}):createSyncAdapter({apiKey:process.env.SYNC_API_KEY,artifactOrigins:origins});
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 await db.query('SET ROLE tanaghom_creative_worker');
 const claimed=args.has('resume-job')?{job_id:args.get('resume-job')}:await claimPresenterJob(db,{operation,worker,leaseSeconds:900});
 if(!claimed){console.log(JSON.stringify({result:'idle',operation,worker}));process.exitCode=2;}
  else{const result=await executePresenterJob({db,storage:createCreativeStorage({env:process.env}),provider,download:options=>downloadArtifact({...options,exactOrigins:origins}),jobId:claimed.job_id,worker,enabled,customEnabled:process.env.CUSTOM_AVATAR_ENABLED==='true'});console.log(JSON.stringify({result:'executed',...result}));}
}finally{await db.end();}
