// Server runtime only. Never log upstream headers, bodies, or thrown causes.
export class AdapterError extends Error {
 constructor(code,status=400,metadata={}) { super(code);this.name='AdapterError';this.code=code;this.status=status;this.metadata=metadata; }
 toJSON(){return {code:this.code,status:this.status,metadata:this.metadata};}
}
export const fail=(code,status=400,metadata)=>{throw new AdapterError(code,status,metadata);};
export function closed(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('unsupported_input');}
export function safeId(value){return typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value)?value:null;}
export function endpoint(value,ownedLoopbackTest=false){
 let u;try{u=new URL(value);}catch{fail('configuration_invalid',503);}
 if((ownedLoopbackTest===true&&u.hostname!=='127.0.0.1')||u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||(ownedLoopbackTest===true&&u.protocol==='http:'&&u.hostname==='127.0.0.1')))fail('configuration_invalid',503);
 return u.href.replace(/\/$/,'');
}
export async function boundedHttp({url,key,header,method='POST',body,maxBytes=131072,timeoutMs=60000,signal,ownedLoopbackTest=false,readBilling}) {
 url=endpoint(url,ownedLoopbackTest);
 if(typeof key!=='string'||!key.trim()||key!==key.trim()||/[\r\n]/.test(key))fail('credentials_missing',503);
 const controller=new AbortController();const started=Date.now();let timedOut=false,reader,paidSuccess=false;
 const abort=()=>controller.abort();if(signal?.aborted)fail('cancelled',499);signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 try{
  const response=await fetch(url,{method,body,headers:{[header]:header==='authorization'?`Bearer ${key}`:key,...(typeof body==='string'?{'content-type':'application/json'}:{})},signal:controller.signal,redirect:'error',cache:'no-store'});
  const metadata={status:response.status,requestId:response.headers.get('x-request-id')?.includes(key)?null:safeId(response.headers.get('x-request-id')),latencyMs:0};
  if(!response.ok){const raw=response.headers.get('retry-after');const seconds=raw&&/^\d+$/.test(raw)?Number(raw):raw?Math.ceil((Date.parse(raw)-Date.now())/1000):NaN;
   if(Number.isSafeInteger(seconds)&&seconds>=0)metadata.retryAfterSeconds=seconds;
   await response.body?.cancel();metadata.latencyMs=Date.now()-started;if(response.status>=500)metadata.indeterminate=true;
   const codes={400:'request_rejected',401:'authentication_failed',402:'insufficient_credits',403:'account_forbidden',413:'input_too_large',422:'input_invalid',429:'provider_busy',503:'provider_unavailable',504:'provider_timeout'};
   fail(codes[response.status]||'provider_error',[400,401,402,403,413,422,429,503,504].includes(response.status)?response.status:502,metadata);
  }
  if(response.status!==200){await response.body?.cancel();fail('response_status_invalid',502,{...metadata,indeterminate:true,latencyMs:Date.now()-started});}
  paidSuccess=method==='POST';
  reader=response.body?.getReader();if(!reader)fail('response_invalid',502);let size=0;const chunks=[];
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){controller.abort();void reader.cancel().catch(()=>{});fail('response_too_large',502,{indeterminate:true,latencyMs:Date.now()-started});}chunks.push(part.value);}
  metadata.latencyMs=Date.now()-started;
  const bytes=Buffer.concat(chunks);if(bytes.includes(Buffer.from(key))||metadata.requestId?.includes(key))fail('response_secret_rejected',502);
  if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json'){
   let parsed;try{parsed=JSON.parse(bytes.toString('utf8'));}catch{fail('response_invalid',502);}
   const stack=[parsed];while(stack.length){const v=stack.pop();if(typeof v==='string'&&v.includes(key))fail('response_secret_rejected',502);if(v&&typeof v==='object'){for(const [k,value] of Object.entries(v)){if(k.includes(key))fail('response_secret_rejected',502);stack.push(value);}}}
  }
  if(typeof readBilling==='function'){
   metadata.billing=null;
   try{
    const value=readBilling(response.headers);
    if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['creditsUsed','balance'].includes(k))&&Object.keys(value).length>0&&Object.values(value).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER))metadata.billing={creditsUsed:value.creditsUsed??null,balance:value.balance??null};
   }catch{/* Unverified/malformed billing stays unavailable; never echo headers or causes. */}
  }
  return {bytes,contentType:response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(),metadata};
 }catch(error){if(error instanceof AdapterError){if(paidSuccess)error.metadata={...error.metadata,indeterminate:true};throw error;}fail(timedOut?'deadline_exceeded':signal?.aborted?'cancelled':'transport_indeterminate',timedOut?504:signal?.aborted?499:502,{indeterminate:true,latencyMs:Date.now()-started});}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);reader?.releaseLock();}
}
export function jsonResponse(response){if(response.contentType!=='application/json')fail('response_invalid',502);try{return JSON.parse(response.bytes.toString('utf8'));}catch{fail('response_invalid',502);}}
// Optional in-admission validator; legacy provider-neutral transports still work.
export async function acceptResponse(transport,args,accept){let accepted=false;const result=await transport(...args,response=>{accepted=true;return accept(response);});return accepted?result:accept(result);}
