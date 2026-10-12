import {closed,fail,jsonResponse,safeId,acceptResponse} from './http.mjs';
import {inspectWav,checksum} from './audio.mjs';
export class AsrAdapter {
 constructor({transport,readControlledAudio,inspectCompressed}){this.transport=transport;this.readControlledAudio=readControlledAudio;this.inspectCompressed=inspectCompressed;}
 async transcribe(input,{signal}={}){
  closed(input,['sourceVersionId']);if(typeof input.sourceVersionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.sourceVersionId))fail('source_version_invalid');
  if(typeof this.readControlledAudio!=='function')fail('controlled_reader_required',503);
  const asset=await this.readControlledAudio(input.sourceVersionId);
  if(!asset||asset.versionId!==input.sourceVersionId||!Buffer.isBuffer(asset.bytes)||!asset.bytes.length)fail('controlled_audio_not_found',404);
  const bytes=Buffer.from(asset.bytes);if(bytes.length>25*1024*1024)fail('input_too_large',413);
  if(checksum(bytes)!==asset.sha256)fail('source_checksum_invalid',422);
  const isWav=bytes.subarray(0,4).equals(Buffer.from('RIFF'));
  const info=isWav?inspectWav(bytes):await this.inspectCompressed?.(bytes,{signal,maxDuration:20});
  if(!info)fail('bounded_decoder_required',503);
  if(!['audio/wav','audio/mpeg','audio/ogg','audio/flac','audio/aac'].includes(info.mime)||info.mime!==asset.mime||!Number.isFinite(info.duration)||info.duration<=0||info.duration>20)fail('audio_invalid',422);
  return acceptResponse(this.transport,[{bytes,mime:info.mime},signal],response=>{const v=jsonResponse(response);
  if(typeof v?.text!=='string'||!v.text.trim()||v.language!=='ar'||!Number.isFinite(v.duration)||v.duration<=0||v.duration>20||!Number.isFinite(v.processing_time_ms)||v.processing_time_ms<0||(v.request_id!==undefined&&!safeId(v.request_id)))fail('response_invalid',502);
  return {text:v.text,language:'ar',duration:v.duration,source:{versionId:asset.versionId,assetId:asset.assetId,jobId:asset.jobId,sha256:asset.sha256},metadata:{...response.metadata,requestId:safeId(v.request_id)||response.metadata.requestId,processingTimeMs:v.processing_time_ms}};});
 }
}
