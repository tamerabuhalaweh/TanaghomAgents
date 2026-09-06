// Local disposable authentication and authored outputs only. No customer session
// is imported, and no network request to Gemma/Postiz/GHL is made by this test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { chromium, expect } from '@playwright/test';
import { workspaceArtifact } from '../packages/agent-runtime/workspace.mjs';

export async function workspaceBrowser(pool, databaseUrl, workerUrl) {
 const authOrigin='http://127.0.0.1:43191',origin='http://127.0.0.1:43192';
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const key={...await exportJWK(publicKey),kid:'workspace-disposable',alg:'RS256',use:'sig'};
 const subject='90000000-0000-4000-8000-000000000001';
 const token=async sub=>new SignJWT({role:'authenticated',email:'owner@example.test'}).setProtectedHeader({alg:'RS256',kid:key.kid}).setIssuer(`${authOrigin}/auth/v1`).setAudience('authenticated').setSubject(sub).setIssuedAt().setExpirationTime('1h').sign(privateKey);
 const server=createServer(async(req,res)=>{
  if(req.url==='/auth/v1/.well-known/jwks.json'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({keys:[key]}));return;}
  if(req.method==='POST'&&req.url?.startsWith('/auth/v1/token')){
   const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());
   if(body.email==='owner@example.test'&&body.password==='disposable-browser-only'){
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({access_token:await token(subject),refresh_token:'disposable-refresh',expires_in:3600}));return;
   }
  }res.writeHead(401).end();
 });
 let app,browser;let logs='';
 try{
  server.listen(43191,'127.0.0.1');await once(server,'listening');
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/dashboard','-p','43192','-H','127.0.0.1'],{env:{...process.env,
   APP_ENV:'integration',DATABASE_URL:databaseUrl,SUPABASE_URL:authOrigin,SUPABASE_JWKS_URL:`${authOrigin}/auth/v1/.well-known/jwks.json`,SUPABASE_PUBLISHABLE_KEY:'disposable-public-key',SUPABASE_SECRET_KEY:'',
   AGENCY_WORKSPACE_ENABLED:'true',AGENCY_WORKSPACE_DATABASE_URL:workerUrl,GEMMA_API_KEY:'fixture',AGENCY_WORKSPACE_WORKER_TOKEN:'disposable-workspace-worker-token-32-characters',
   AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED:'false',AGENCY_PILOT_GATEWAY_ENABLED:'false',POSTIZ_HANDOFF_ENABLED:'false',GHL_CONTACT_HANDOFF_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',c=>{logs+=c});app.stderr.on('data',c=>{logs+=c});
  for(let i=0;i<100;i++){if(app.exitCode!==null)throw new Error(logs);try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.equal((await fetch(`${origin}/api/workspace`)).status,401);
  assert.equal((await fetch(`${origin}/api/internal/agency-workspace`,{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"tick"}'})).status,401);
  await pool.query("UPDATE tanaghom.agency_workspace_control SET enabled=true,emergency_stop=false,reason='Disposable browser test';UPDATE tanaghom.agent_runtime_controls SET emergency_stop=false");
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.goto(`${origin}/login`);await page.getByLabel('Email').fill('owner@example.test');await page.getByLabel('Password',{exact:true}).fill('disposable-browser-only');
  await page.getByRole('button',{name:'Enter workspace',exact:true}).click();await page.waitForURL(url=>url.pathname!=='/login');
  await page.goto(`${origin}/workspace`);await expect(page.getByRole('heading',{name:'AI workspace',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'New assignment',exact:true}).click();
  await page.getByLabel('Assignment title').fill('Photography launch — browser fixture');
  await page.getByLabel('Task brief',{exact:true}).fill('Prepare an organic Instagram launch for our beginner photography course, with practical content and a support playbook.');
  await page.getByLabel('Shared source facts & brand guidance').fill('Fictional studio in Amman. Six lessons teach exposure and composition. No confirmed price or date. Tone: helpful, clear, no sales guarantees.');
  await page.getByRole('button',{name:'Save assignment',exact:true}).click();await expect(page.getByRole('button',{name:'Start assignment',exact:true})).toBeEnabled();
  const wid=new URL(page.url()).searchParams.get('id');assert.ok(wid);
  await page.getByRole('button',{name:'Start assignment',exact:true}).click();await expect(page.getByText('0 of 6 deliverables ready')).toBeVisible();
  for(let i=0;i<6;i++){
   const task=(await pool.query('SELECT tanaghom.claim_agency_workspace_task() AS t')).rows[0].t;assert.equal(task.workspace_id,wid);assert.equal(task.shared_context.length,i);
   const content=`${['Campaign strategy','Content draft','Brand review','Discovery playbook','Support responses','Summary'][i]}\n\nAUTHORED TEST FIXTURE — not Gemma output.\n\nThe campaign introduces the six photography lessons through practical exposure and composition examples. Use organic Instagram only. Price and dates remain unconfirmed.\n\nProposed next step: ask interested learners which photography skill they want to improve. A human must review the final material before use.\n\nShared prior deliverables: ${i}.`;
   const result=workspaceArtifact(task,task.profile==='executive_summary'?null:{model:task.model,choices:[{finish_reason:'stop',message:{content}}]},1);
   await pool.query('SELECT tanaghom.complete_agency_workspace_task($1,$2,$3,NULL)',[task.task_id,task.lease_token,result]);
  }
  await expect(page.getByRole('button',{name:'Approve work pack',exact:true})).toBeVisible({timeout:15000});
  await page.getByRole('navigation',{name:'Specialist tasks'}).getByRole('button').nth(2).click();
  await page.getByRole('tab',{name:'Shared context',exact:true}).click();await expect(page.getByText('Social Media Strategist · unapproved proposal')).toBeVisible();
  await page.getByRole('tab',{name:'Deliverable',exact:true}).click();
  mkdirSync('tmp/workspace-qa',{recursive:true});await page.screenshot({path:'tmp/workspace-qa/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.sidebar')).toBeHidden();await page.screenshot({path:'tmp/workspace-qa/mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow at mobile width');
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Approve work pack',exact:true}).click();await expect(page.getByText('Approved by human',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:/Fictional ar work pack/}).click();await expect(page.locator('.aw-document')).toHaveAttribute('dir','rtl');
  await page.screenshot({path:'tmp/workspace-qa/arabic.png',fullPage:true});
  const csrf=await page.request.post(`${origin}/api/workspace`,{headers:{origin:'https://untrusted.test'},data:{action:'cancel',id:wid}});assert.equal(csrf.status(),401);
  // A real restricted-worker HTTP tick is exercised with the deterministic
  // profile only; by contract it never makes an inference request.
  const bearer=await token(subject),request=async body=>fetch(`${origin}/api/workspace`,{method:'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify(body)});
  const r=await request({action:'create',title:'Summary-only fixture',brief:'Produce a delivery receipt for this synthetic assignment without external actions.',source_facts:'This is a fixture. There are no measured results or completed prior tasks.',language:'en',profile:'executive_summary',idempotency_key:randomUUID()});assert.equal(r.status,200);const single=(await r.json()).id;
  assert.equal((await request({action:'start',id:single})).status,200);
  const tick=await fetch(`${origin}/api/internal/agency-workspace`,{method:'POST',headers:{authorization:'Bearer disposable-workspace-worker-token-32-characters','content-type':'application/json'},body:'{"action":"tick"}'});
  assert.equal(tick.status,200);assert.equal((await tick.json()).status,'succeeded');
  assert.equal((await pool.query('SELECT status FROM tanaghom.agency_workspaces WHERE id=$1',[single])).rows[0].status,'waiting_review');
  // Missing membership, viewer mutation and tenant-scoped reads are rejected.
  const unknown=await token(randomUUID());assert.equal((await fetch(`${origin}/api/workspace`,{headers:{authorization:`Bearer ${unknown}`}})).status,403);
  const otherOrg=randomUUID(),otherUser=randomUUID(),otherSubject=randomUUID();
  await pool.query('INSERT INTO tanaghom.organizations(id,slug,name) VALUES($1,$2,$3)',[otherOrg,`fixture-${otherOrg}`,'Other disposable tenant']);
  await pool.query("INSERT INTO tanaghom.app_users(id,organization_id,email,display_name,kind,role,auth_subject,accepted_at) VALUES($1,$2,'other@example.test','Other owner','human','owner',$3,now())",[otherUser,otherOrg,otherSubject]);
  const foreignToken=await token(otherSubject);
  const foreignRead=await fetch(`${origin}/api/workspace?id=${wid}`,{headers:{authorization:`Bearer ${foreignToken}`}});assert.equal(foreignRead.status,404);
  const foreignList=await fetch(`${origin}/api/workspace`,{headers:{authorization:`Bearer ${foreignToken}`}});assert.deepEqual((await foreignList.json()).assignments,[]);
  await pool.query("UPDATE tanaghom.app_users SET role='viewer' WHERE id='00000000-0000-4000-8000-000000000001'");
  assert.equal((await request({action:'cancel',id:single})).status,403);
  await pool.query("UPDATE tanaghom.app_users SET role='owner' WHERE id='00000000-0000-4000-8000-000000000001'");
  assert.deepEqual(failures,[]);console.log('PASS authenticated browser: login, create, start, six handoffs, context, mobile, approval, worker token and role boundaries; real inference calls=0');
 }catch(error){console.error(logs.slice(-6000));throw error;}
 finally{if(browser)await browser.close();if(app&&app.exitCode===null){app.kill();await once(app,'exit');}await new Promise(r=>server.close(r));}
}
