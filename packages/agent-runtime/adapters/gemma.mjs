import {closed,fail,jsonResponse,AdapterError,acceptResponse} from './http.mjs';
function countWithin(callback,budget,signal){
 if(budget<=0)fail('deadline_exceeded',504,{indeterminate:false});
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(action,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);action(value);};
  const abort=()=>finish(reject,new AdapterError('cancelled',499,{indeterminate:false}));
  const timer=setTimeout(()=>finish(reject,new AdapterError('deadline_exceeded',504,{indeterminate:false})),budget);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  Promise.resolve().then(callback).then(value=>finish(resolve,value),()=>finish(reject,new AdapterError('token_counter_failed',503)));
 });
}
export class GemmaAdapter {
 constructor({transport,model,tokenCounter,thinkingDisabled,deadlineMs=60000}){this.transport=transport;this.model=model;this.tokenCounter=tokenCounter;this.thinkingDisabled=thinkingDisabled;this.deadlineMs=Number.isInteger(deadlineMs)&&deadlineMs>0?Math.min(deadlineMs,60000):60000;}
 async complete(input,{signal}={}){
  const started=Date.now();if(signal?.aborted)fail('cancelled',499,{indeterminate:false});
  closed(input,['messages','temperature','max_tokens','model']);
  if(input.model!==undefined&&input.model!==this.model)fail('model_invalid');
  if(!Array.isArray(input.messages)||input.messages.length<1||input.messages.length>64)fail('messages_invalid');
  const messages=input.messages.map(m=>{closed(m,['role','content']);if(!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim())fail('messages_invalid');return {...m};});
  const max_tokens=input.max_tokens??2048,temperature=input.temperature??0.3;
  if(!Number.isInteger(max_tokens)||max_tokens<1||max_tokens>2048||typeof temperature!=='number'||!Number.isFinite(temperature)||temperature<0||temperature>2)fail('generation_budget');
  const payload={model:this.model,messages,temperature,max_tokens,stream:false};
  if(Buffer.byteLength(JSON.stringify(payload))>32768)fail('request_too_large',413);
  if(typeof this.tokenCounter!=='function')fail('exact_token_counter_required',503);
  const tokens=await countWithin(()=>this.tokenCounter({model:this.model,messages}),this.deadlineMs-(Date.now()-started),signal);if(!Number.isInteger(tokens)||tokens<1||tokens>8192)fail('input_token_budget',413);
  if(this.thinkingDisabled!==true)fail('thinking_contract_required',503);
  const remaining=this.deadlineMs-(Date.now()-started);if(remaining<=0)fail('deadline_exceeded',504,{indeterminate:false});
  return acceptResponse(this.transport,['complete',JSON.stringify(payload),signal,remaining],response=>{const value=jsonResponse(response),choice=value?.choices?.[0];
  if(value?.model!==this.model||!Array.isArray(value.choices)||value.choices.length!==1||!choice||!['stop','length'].includes(choice.finish_reason)||choice.message?.role!=='assistant'||typeof choice.message.content!=='string'||!choice.message.content.trim()||choice.message.tool_calls!==undefined||choice.message.reasoning_content)fail('response_invalid',502);
  let usage=null;if(value.usage!==undefined){const u=value.usage;if(!u||!['prompt_tokens','completion_tokens','total_tokens'].every(k=>Number.isSafeInteger(u[k])&&u[k]>=0)||u.prompt_tokens>8192||u.completion_tokens>max_tokens||u.total_tokens!==u.prompt_tokens+u.completion_tokens)fail('usage_invalid',502);usage={prompt_tokens:u.prompt_tokens,completion_tokens:u.completion_tokens,total_tokens:u.total_tokens};}
  if(Date.now()-started>this.deadlineMs)fail('deadline_exceeded',504,{indeterminate:false});
  return {text:choice.message.content,metadata:{...response.metadata,latencyMs:Date.now()-started,model:this.model,usage,finishReason:choice.finish_reason}};});
 }
 async models({signal}={}){
  const response=await this.transport('models',undefined,signal);const value=jsonResponse(response);
  if(!Array.isArray(value?.data)||value.data.length>128||value.data.some(m=>typeof m?.id!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(m.id)))fail('model_inventory_invalid',502);
  if(!value.data.some(m=>m.id===this.model))fail('model_unavailable',503);
  return {models:value.data.map(m=>({id:m.id})),metadata:response.metadata};
 }
}
