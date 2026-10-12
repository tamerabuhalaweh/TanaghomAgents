import type {AdapterDependencies,Metadata,GemmaResult,TtsResult,AsrResult} from '../providers/smartlabs.js';
export type {AdapterDependencies,Metadata,GemmaResult,TtsResult,AsrResult,AudioSource,Adapters} from '../providers/smartlabs.js';
export interface TransportResponse {bytes:Buffer;contentType?:string;metadata:Metadata}
export class GemmaAdapter {
 constructor(options:{transport:(operation:string,body?:string,signal?:AbortSignal,remainingMs?:number)=>Promise<TransportResponse>;model:string;tokenCounter?:AdapterDependencies['tokenCounter'];thinkingDisabled?:boolean;deadlineMs?:number});
 complete(input:Record<string,unknown>,options?:{signal?:AbortSignal}):Promise<GemmaResult>;
 models(options?:{signal?:AbortSignal}):Promise<{models:{id:string}[];metadata:Metadata}>;
}
export class TtsAdapter {
 constructor(options:{transport:(text:string,signal?:AbortSignal)=>Promise<TransportResponse>;backend:string});
 synthesize(input:{text:string},options?:{signal?:AbortSignal}):Promise<TtsResult>;
}
export class AsrAdapter {
 constructor(options:{transport:(audio:{bytes:Buffer;mime:string},signal?:AbortSignal)=>Promise<TransportResponse>;readControlledAudio?:AdapterDependencies['readControlledAudio'];inspectCompressed?:AdapterDependencies['inspectCompressed']});
 transcribe(input:{sourceVersionId:string},options?:{signal?:AbortSignal}):Promise<AsrResult>;
}
