// Disposable actual process crash receipt: attach succeeds, parent SIGKILLs.
import pg from 'pg';
import {createHeyGenAdapter} from '../packages/creative-runtime/adapters/heygen.mjs';
import {executePresenterJob} from '../packages/creative-runtime/render/presenter-worker.mjs';
import {createLocalFsStorage} from '../packages/creative-runtime/storage/local-fs.mjs';
import {downloadArtifact} from '../packages/creative-runtime/adapters/http-image.mjs';
const [jobId,worker,dir,origin]=process.argv.slice(2);
if(!process.env.DATABASE_TEST_URL||!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_TEST_URL).hostname)||new URL(origin).hostname!=='127.0.0.1')throw new Error('fixture_only');
const workerUrl=process.env.P5_WORKER_DATABASE_URL;
if(!workerUrl||new URL(workerUrl).username!=='tanaghom_creative_worker'||!['localhost','127.0.0.1'].includes(new URL(workerUrl).hostname))throw new Error('restricted_fixture_worker_required');
const db=new pg.Client({connectionString:workerUrl});await db.connect();
const provider=createHeyGenAdapter({apiKey:'fixture-only',endpoint:origin,testLoopback:true,artifactOrigins:[origin]});
await executePresenterJob({db,storage:createLocalFsStorage({dir}),provider:{...provider,queryTask:async()=>{process.stdout.write('P5_TASK_ATTACHED\n');await new Promise(()=>{});}},download:downloadArtifact,jobId,worker,enabled:true});
