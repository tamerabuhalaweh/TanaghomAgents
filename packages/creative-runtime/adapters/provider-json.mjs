import {ProviderAdapterError} from './http-image.mjs';
// Small status/create JSON boundary; media still uses the existing downloader.
export async function readProviderJson(response,maxBytes=1048576){
 const reader=response.body?.getReader?.();if(!reader)throw new ProviderAdapterError('indeterminate','provider_response_unknown');
 const chunks=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('large');}chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{throw new ProviderAdapterError('indeterminate','provider_response_unknown');}
 finally{reader.releaseLock();}
}
