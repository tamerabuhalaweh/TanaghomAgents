export const workspaceManifest: { contract_version:string; timeout_ms:number };
export const modelEndpoint:string;
export function workspaceRequest(task:Record<string,any>,contextLimit:number):Record<string,any>|null;
export function workspaceArtifact(task:Record<string,any>,response:unknown,elapsedMs:number):Record<string,any>;
