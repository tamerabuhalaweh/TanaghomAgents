export class GeminiWorkspaceError extends Error {
  code:string;
  status:number;
  details:{attempt?:number;error_name?:string;error_message?:string;http_status?:number;upstream_error?:string;finish_reason?:string;model?:string}|null;
  http_status:number|null;
  upstream_error:string|null;
  finish_reason:string|null;
}
export interface GeminiModelInventory { id:string; resource:string; inputTokenLimit:number; outputTokenLimit:number }
export interface GeminiWorkspaceClient {
  inventory(model:string):Promise<GeminiModelInventory>;
  generate(model:string,payload:Record<string,unknown>):Promise<unknown>;
}
export function geminiGenerateEndpoint(model:string,baseUrl?:string):string;
export function createGeminiWorkspaceClient(options?:{
  apiKey?:string;
  baseUrl?:string;
  fetch?:typeof fetch;
  timeoutMs?:number;
  attemptTimeoutMs?:number;
  inventoryTimeoutMs?:number;
  retryDelaysMs?:number[];
}):GeminiWorkspaceClient;
