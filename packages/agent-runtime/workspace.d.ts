export interface WorkspaceProfile { code:string; name:string; role:string; deliverable:string; instruction:string }
export const workspaceManifest: { contract_version:string; profiles:WorkspaceProfile[]; max_output_tokens:number; timeout_ms:number };
export const workspaceHash:string;
export const modelEndpoint:string;
export function workspaceRequest(task:Record<string,any>,contextLimit:number):Record<string,any>|null;
export function workspaceArtifact(task:Record<string,any>,response:unknown,elapsedMs:number):Record<string,any>;
