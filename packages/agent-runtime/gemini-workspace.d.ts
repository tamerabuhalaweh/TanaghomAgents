export class GeminiWorkspaceError extends Error { code:string; status:number }
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
  inventoryTimeoutMs?:number;
}):GeminiWorkspaceClient;
