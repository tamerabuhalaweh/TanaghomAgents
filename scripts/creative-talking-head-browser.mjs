import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
async function session({origin,mintToken,subject,width=1280}){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width,height:900}});
 await context.addCookies([{name:'tanaghom_access_token',value:await mintToken(subject),url:origin},{name:'tanaghom_locale',value:'ar',url:origin}]);return{browser,page:await context.newPage()};
}
export async function runPresenterBrowser(options){
 const jobs=[],directory=process.env.P5_EVIDENCE_DIR??'evaluation/creative-talking-head-v1',errors=[];
 for(const width of options.widths??[1280,390]){
  const {browser,page}=await session({...options,width});page.on('pageerror',e=>errors.push(e.message));
  try{
   const cases=width===1280?[['ar','مرحباً بكم في هذا الاختبار.'],['en','Hello, this is the controlled fixture.'],['ar-EN','مرحباً بكم، this is mixed Arabic and English.'],['ar','حقّاً؟ نعم، بالتأكيد!'],['ar','مرحباً! الاختبار ١٢٣ ABC 42، صحيح؟']]:[['ar','مرحباً! الاختبار ١٢٣ ABC 42، صحيح؟']];
   for(const [language,script] of options.cases??cases){
    await page.goto(options.origin+'/creative/presenters',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'استوديو المتحدث'}).waitFor();assert.equal(await page.locator('.creative-page').getAttribute('dir'),'rtl');assert.equal(await page.getByText('talking_head · succeeded',{exact:false}).count(),0);
    await page.getByLabel('المقدم',{exact:false}).selectOption(options.bindingId);await page.getByLabel('النص',{exact:false}).fill(script);await page.locator('form').getByLabel('اللغة').selectOption(language);await page.getByLabel('التنسيق').selectOption('9:16');
    await page.screenshot({path:`${directory}/rtl-${width}.png`,fullPage:true});assert.equal(await page.getByRole('button',{name:/نشر|Publish/}).count(),0);
    const submitted=page.waitForResponse(r=>r.url().endsWith('/api/creative/presenters/generate')&&r.request().method()==='POST');await page.getByRole('button',{name:'إنشاء مسودة'}).click();const response=await submitted;assert.equal(response.status(),200);await page.waitForURL(/\/creative\/jobs\/[0-9a-f-]{36}/);jobs.push({job_id:new URL(page.url()).pathname.split('/').pop(),operation:'talking_head',language});
   }
   if(width===1280){
    await page.goto(options.origin+'/creative/presenters',{waitUntil:'networkidle'});await page.getByLabel('العملية').selectOption('lip_sync');assert.ok(await page.getByLabel('الصوت المعتمد').locator('option').filter({hasText:'Controlled MP3'}).count());
    await page.getByLabel('المقدم',{exact:false}).selectOption(options.syncBinding);await page.getByLabel('الفيديو المعتمد').selectOption(options.sourceVideo);await page.getByLabel('الصوت المعتمد',{exact:false}).selectOption(options.sourceAudio);
    const submitted=page.waitForResponse(r=>r.url().endsWith('/api/creative/presenters/generate')&&r.request().method()==='POST');await page.getByRole('button',{name:'إنشاء مسودة'}).click();const response=await submitted;assert.equal(response.status(),200);await page.waitForURL(/\/creative\/jobs\/[0-9a-f-]{36}/);jobs.push({job_id:new URL(page.url()).pathname.split('/').pop(),operation:'lip_sync'});
    await page.screenshot({path:`${directory}/rtl-lip-sync.png`,fullPage:true});
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.goto(options.origin+'/creative/avatars',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'إدارة الشخصيات'}).waitFor();await page.screenshot({path:`${directory}/avatars-rtl-${width}.png`,fullPage:true});
  }finally{await browser.close();}
 }
 assert.deepEqual(errors,[]);writeFileSync(directory+'/browser-jobs'+(options.cases?'-operator':'')+'.json',JSON.stringify({fixture_only:true,jobs},null,2));return jobs;
}
export async function verifyPresenterDraftBrowser(options){
 return verifyDraft(options);
}
export async function verifyPresenterAccessBrowser(options){
 const {browser,page}=await session(options);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(options.origin+'/creative/presenters',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'استوديو المتحدث'}).waitFor();
  if(options.disabled){assert.ok(await page.getByRole('button',{name:'إنشاء مسودة'}).isDisabled());await page.getByLabel('العملية').selectOption('lip_sync');assert.ok(await page.getByRole('button',{name:'إنشاء مسودة'}).isDisabled());}
  else assert.equal(await page.getByRole('button',{name:'إنشاء مسودة'}).count(),0);
  assert.equal(await page.getByRole('button',{name:/نشر|Publish/}).count(),0);
  if(options.versionId){await page.goto(options.origin+'/creative/assets/versions/'+options.versionId,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);assert.equal(await page.getByRole('button',{name:/^اعتماد$|^رفض$/}).count(),0);}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
async function verifyDraft(options){
 const {browser,page}=await session(options);
 try{
  await page.goto(options.origin+'/creative/jobs/'+options.jobId,{waitUntil:'networkidle'});await page.getByRole('link',{name:options.assetId,exact:true}).waitFor();
  await page.goto(options.origin+'/creative/assets/versions/'+options.versionId,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.videoWidth===360&&v.videoHeight===640&&v.readyState>=2;});
  await page.locator('video').evaluate(async v=>{v.muted=true;await v.play();});await page.waitForFunction(()=>{const v=document.querySelector('video');return v.currentTime>.1&&v.getVideoPlaybackQuality().totalVideoFrames>0;});await page.locator('video').evaluate(v=>v.pause());
  const dimensions=await page.locator('video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,decodedFrames:v.getVideoPlaybackQuality().totalVideoFrames}));assert.equal(dimensions.width,360);assert.equal(dimensions.height,640);assert.ok(Math.abs(dimensions.duration-5)<.5);
  assert.ok(await page.getByText('معلومات المصدر والتوليد',{exact:false}).isVisible());await page.screenshot({path:`${process.env.P5_EVIDENCE_DIR??'evaluation/creative-talking-head-v1'}/preview-${options.operation}.png`,fullPage:true});
  const decision=page.waitForResponse(r=>r.url().endsWith('/decision')&&r.request().method()==='POST');if(options.decision==='rejected'){await page.getByLabel(/ملاحظات/).fill('Controlled fixture rejection; not a quality claim.');await page.getByRole('button',{name:'رفض',exact:true}).click();}else await page.getByRole('button',{name:'اعتماد',exact:true}).click();assert.equal((await decision).status(),200);return dimensions;
 }finally{await browser.close();}
}
