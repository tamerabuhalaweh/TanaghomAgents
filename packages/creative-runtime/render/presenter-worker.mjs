// Independent capabilities on the existing gpu_video queue. P4 attempt ledger
// begin/full-reader/attach/finish/reconcile and existing storage/review reused.
import {createHash} from 'node:crypto';
import {validateMp4} from './mp4.mjs';
import {sha256Hex} from '../storage/keys.mjs';
import {markRunning,getProviderCall,beginProviderCall,attachProviderRequest,finishProviderCall,reconcileProviderCall,failJob,getMotionState,registerVersion,completeJob,getSegmentOutputs} from '../repository.mjs';
export async function claimPresenterJob(db,{operation,worker,leaseSeconds=120}){
 if(!['talking_head','lip_sync'].includes(operation))throw new Error('presenter_operation_invalid');
 return (await db.query('SELECT * FROM tanaghom.claim_creative_presenter_job($1,$2,$3)',[operation,worker,leaseSeconds])).rows[0]??null;
}
async function readInput(db,jobId,worker){return (await db.query('SELECT tanaghom.get_creative_presenter_input($1,$2) AS input',[jobId,worker])).rows[0].input;}
async function readSource(db,jobId,worker,versionId){return (await db.query('SELECT tanaghom.get_creative_presenter_source($1,$2,$3) AS source',[jobId,worker,versionId])).rows[0].source;}
export function validateWave(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>52428800||bytes.toString('latin1',0,4)!=='RIFF'||bytes.toString('latin1',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw new Error('audio_wave_invalid');
 let fmt=null,data=null;
 for(let offset=12;offset+8<=bytes.length;){const size=bytes.readUInt32LE(offset+4),end=offset+8+size;if(end>bytes.length)throw new Error('audio_wave_truncated');const type=bytes.toString('latin1',offset,offset+4);if(type==='fmt '){if(size<16)throw new Error('audio_wave_format');fmt={codec:bytes.readUInt16LE(offset+8),channels:bytes.readUInt16LE(offset+10),sampleRate:bytes.readUInt32LE(offset+12),byteRate:bytes.readUInt32LE(offset+16),blockAlign:bytes.readUInt16LE(offset+20),bits:bytes.readUInt16LE(offset+22)};}if(type==='data')data=size;offset=end+(size%2);}
 if(!fmt||!data||fmt.codec!==1||![1,2].includes(fmt.channels)||![44100,48000].includes(fmt.sampleRate)||![16,24,32].includes(fmt.bits)||fmt.blockAlign!==fmt.channels*fmt.bits/8||fmt.byteRate!==fmt.sampleRate*fmt.blockAlign||data%fmt.blockAlign!==0)throw new Error('audio_wave_format');
 return {...fmt,durationSec:data/fmt.byteRate};
}
export function validateMpegAudio(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<4||bytes.length>52428800)throw new Error('audio_mp3_invalid');
 let offset=0;if(bytes.toString('latin1',0,3)==='ID3'){if(bytes.length<10||bytes.subarray(6,10).some(x=>x>127)||bytes[5]&16)throw new Error('audio_mp3_invalid');offset=10+((bytes[6]<<21)|(bytes[7]<<14)|(bytes[8]<<7)|bytes[9]);if(offset>=bytes.length)throw new Error('audio_mp3_invalid');}
 let frames=0,sampleRate=null,channels=null;const rates=[44100,48000,32000],bitrates=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
 const end=bytes.length>=128&&bytes.toString('latin1',bytes.length-128,bytes.length-125)==='TAG'?bytes.length-128:bytes.length;
 while(offset+4<=end){const header=bytes.readUInt32BE(offset);if((header>>>21)!==2047||((header>>>19)&3)!==3||((header>>>17)&3)!==1)throw new Error('audio_mp3_invalid');const rate=rates[(header>>>10)&3],bitrate=bitrates[(header>>>12)&15],ch=((header>>>6)&3)===3?1:2;if(![44100,48000].includes(rate)||!bitrate||(sampleRate!==null&&(sampleRate!==rate||channels!==ch)))throw new Error('audio_mp3_invalid');sampleRate=rate;channels=ch;const size=Math.floor(144000*bitrate/rate)+((header>>>9)&1);if(offset+size>end)throw new Error('audio_mp3_invalid');offset+=size;frames++;}
 if(offset!==end||!frames)throw new Error('audio_mp3_invalid');return {codec:'mp3',channels,sampleRate,frames,durationSec:frames*1152/sampleRate};
}
async function controlledMedia(db,storage,jobId,worker,versionId,kind){
 const ref=await readSource(db,jobId,worker,versionId);const stored=await storage.get(ref.object_key);
 if(!stored||stored.mime!==ref.mime||stored.bytes.length!==Number(ref.bytes)||sha256Hex(stored.bytes)!==ref.sha256)throw new Error('presenter_source_checksum');
 if(kind==='video'){if(ref.mime!=='video/mp4')throw new Error('presenter_video_mime');if(!Number.isInteger(ref.width)||!Number.isInteger(ref.height)||ref.width<1||ref.height<1)throw new Error('presenter_video_dimensions');validateMp4(stored.bytes,{width:ref.width,height:ref.height,expectedDurationSec:ref.duration_ms/1000,allowedCodecs:['avc1']});}
 else {if(!['audio/wav','audio/mpeg'].includes(ref.mime))throw new Error('presenter_audio_codec_not_enabled');const audio=ref.mime==='audio/wav'?validateWave(stored.bytes):validateMpegAudio(stored.bytes);if(Math.abs(audio.durationSec-ref.duration_ms/1000)>.25)throw new Error('presenter_audio_duration');}
 return stored;
}
export async function executePresenterJob({db,storage,provider,download,jobId,worker,enabled=false,customEnabled=false,pollIntervalMs=10000,pollTimeoutMs=600000,readActualCost=null}){
 if(!enabled)throw new Error('presenter_worker_disabled');
 let callId=null,taskId=null,callStatus=null,remoteSucceeded=false;
 const fail=async(errorClass,message)=>{await failJob(db,{jobId,worker,errorClass,errorMessage:message.slice(0,300)});const e=new Error(message);e.errorClass=errorClass;throw e;};
 async function settle(status,errorClass=null,message=null,actualCostUsd=null){const fn=callStatus==='started'?finishProviderCall:reconcileProviderCall;await fn(db,{callId,worker,requestId:taskId,status,errorClass,errorMessage:message,actualCostUsd});callStatus=status;}
 try{
  const initialState=await getMotionState(db,{jobId,worker});
  if(initialState.status==='claimed'&&await markRunning(db,{jobId,worker})==='cancelled')throw Object.assign(new Error('presenter_local_cancel'),{errorClass:'cancelled',alreadyFailed:true});
  if(!['claimed','running'].includes(initialState.status))throw new Error('presenter_job_not_active');
  let input=await readInput(db,jobId,worker);const p=input.params,auth=input.authorization;
  if(auth.avatar_type==='custom_real_person'&&!customEnabled)throw new Error('custom_avatar_disabled');
  if(provider.name!==auth.provider||provider.model!==auth.model)throw new Error('presenter_provider_mismatch');
  const outputs=await getSegmentOutputs(db,{jobId,worker});
  if(outputs.length){const output=outputs[0],stored=await storage.get(output.object_key);if(!stored||sha256Hex(stored.bytes)!==output.sha256)throw new Error('presenter_recovery_checksum');await completeJob(db,{jobId,worker,assetVersionId:output.version_id});return {jobId,versionId:output.version_id,resumed:true};}
  // Full-reader errors are NOT absence: fail closed, never blind create.
  const prior=await getProviderCall(db,{jobId,worker,operation:p.operation});
  if(prior){callId=prior.call_id;callStatus=prior.status;taskId=prior.provider_request_id;if(!taskId)throw new Error('presenter_blind_retry_refused');}
  else{
   const state=await getMotionState(db,{jobId,worker});if(state.cancel_requested)return await fail('cancelled','presenter_local_cancel_before_create');
   let media=null;if(p.operation==='lip_sync'){media={video:await controlledMedia(db,storage,jobId,worker,p.source_video_version_id,'video'),audio:await controlledMedia(db,storage,jobId,worker,p.source_audio_version_id,'audio')};}
   // Recheck governance AFTER reading bytes and immediately before begin/create.
   input=await readInput(db,jobId,worker);
   callId=await beginProviderCall(db,{jobId,worker,provider:provider.name,model:provider.model,modelVersion:provider.modelVersion,operation:p.operation,units:{seconds:p.duration,locale:p.locale??null,script_hash:p.script_hash??null},estimatedCostUsd:null,adapterConfig:'creative.presenters.v1'});callStatus='started';
   try{const created=p.operation==='talking_head'?await provider.createTalkingHead({script:p.script,locale:p.locale,ratio:p.ratio,providerAvatarId:auth.provider_avatar_id,voiceId:auth.voice_id,idempotencyKey:jobId}):await provider.createLipSync({...media,idempotencyKey:jobId});taskId=created.taskId;}
   catch(e){const cls=e.errorClass??'indeterminate';await settle(['capacity','deterministic'].includes(cls)?'failed':'indeterminate',cls,e.message);return await fail(cls==='capacity'?'transient':cls,e.message);}
   await attachProviderRequest(db,{callId,worker,requestId:taskId});
  }
  const started=Date.now();let terminal=null,localCancel=false;
  while(Date.now()-started<pollTimeoutMs){localCancel=localCancel||(await getMotionState(db,{jobId,worker})).cancel_requested;try{terminal=await provider.queryTask(taskId);}catch{terminal=null;}if(terminal&&['succeeded','failed','cancelled'].includes(terminal.status))break;await new Promise(r=>setTimeout(r,pollIntervalMs));}
  if(!terminal||terminal.status==='running'){await settle('indeterminate','indeterminate','presenter_poll_timeout');return await fail('transient','presenter_poll_timeout');}
  if(terminal.status!=='succeeded'){await settle(terminal.status,terminal.status==='cancelled'?'cancelled':'deterministic','provider terminal '+terminal.status);return await fail(terminal.status==='cancelled'?'cancelled':'deterministic','presenter_provider_'+terminal.status);}
  // Genuine actual cost is not exposed by either accepted status contract.
  await settle('succeeded');remoteSucceeded=true;
  // Neither accepted status endpoint exposes an authoritative charge. Fail
  // closed until a separately accepted, trusted worker-side ledger supplies it.
  // The source-only fixture injects its explicitly synthetic charge receipt.
  const charge=typeof readActualCost==='function'?await readActualCost({provider:provider.name,taskId,jobId}):null;
  if(!charge||charge.taskId!==taskId||typeof charge.usd!=='number'||!Number.isFinite(charge.usd)||charge.usd<0||typeof charge.source!=='string'||!charge.source.trim())throw new Error('presenter_actual_cost_pending');
  await settle('succeeded',null,null,charge.usd);
  localCancel=localCancel||(await getMotionState(db,{jobId,worker})).cancel_requested;
  const artifact=await download({url:terminal.url,maxBytes:provider.maxBytes,allowedOrigins:provider.artifactOrigins,testLoopback:provider.testLoopback});
  const checked=validateMp4(artifact.bytes,{expectedDurationSec:terminal.duration??p.duration,allowedCodecs:['avc1','mp4v'],requireAudio:true});
  if(checked.durationSec<=0||checked.durationSec>60)throw new Error('presenter_output_duration');
  const key=`t/${input.organization_id}/${p.operation}/${jobId}/v1.mp4`;
  try{await storage.put(key,artifact.bytes,'video/mp4');}catch(e){if(e.message!=='object_key_exists')throw e;const existing=await storage.get(key);if(!existing||sha256Hex(existing.bytes)!==sha256Hex(artifact.bytes))throw new Error('presenter_immutable_output_conflict');}
  localCancel=localCancel||(await getMotionState(db,{jobId,worker})).cancel_requested;
  const provenance={operation:p.operation,...auth,provider_task_id:taskId,provider_request_id:taskId,model_version:provider.modelVersion,script_hash:p.script_hash??null,script_length:p.script_length??null,locale:p.locale??null,source_video_version_id:p.source_video_version_id??null,source_audio_version_id:p.source_audio_version_id??null,estimated_cost_usd:null,actual_cost_usd:charge.usd,actual_cost_status:'SETTLED',actual_cost_source:charge.source,remote_outcome:'succeeded',local_cancel_requested:!!localCancel,video:checked,correlation_id:input.correlation_id,job_id:jobId};
  const versionId=await registerVersion(db,{jobId,worker,title:'Presenter draft',mime:'video/mp4',width:checked.width,height:checked.height,durationMs:Math.round(checked.durationSec*1000),bytes:artifact.bytes.length,sha256:sha256Hex(artifact.bytes),objectKey:key,provenance,method:'render'});
  if(localCancel)await failJob(db,{jobId,worker,errorClass:'cancelled',errorMessage:'local cancellation intent; remote succeeded; draft retained'});else await completeJob(db,{jobId,worker,assetVersionId:versionId});
  return {jobId,versionId,taskId,remoteSucceeded,localCancel};
 }catch(e){
  if(e.alreadyFailed)throw e;
  // Downstream failure NEVER settles or rewrites succeeded provider truth.
  const cls=e.errorClass??(e.code==='P0001'||/checksum|codec|mp4_|audio_|authorization|unavailable|consent|mismatch|disabled|blind_retry/.test(e.message)?'deterministic':'transient');
  try{await failJob(db,{jobId,worker,errorClass:cls,errorMessage:remoteSucceeded?'presenter_local_artifact_failure':e.message.slice(0,300)});}catch{}
  throw e;
 }
}
