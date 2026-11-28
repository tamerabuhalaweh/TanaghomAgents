export interface WorkspaceProfile { code:string; name:string; role:string; deliverable:string; instruction:string }
export const workspaceManifest: {
  contract_version:string;
  provider:{ code:string; name:string; model:string };
  profiles:WorkspaceProfile[];
  max_output_tokens:number;
  timeout_ms:number;
};
export const workspaceHash:string;
export class WorkspaceOutputError extends Error {
  code:string;
  details:{block_reason?:string;finish_reason?:string|null;output_kind?:string}|null;
  finish_reason:string|null;
}
export function workspaceRequest(task:Record<string,any>,contextLimit:number,outputLimit?:number):Record<string,any>|null;
export function workspaceArtifact(task:Record<string,any>,response:unknown,elapsedMs:number):Record<string,any>;
export function bilingualRequested(task:Record<string,any>):boolean;
export function normalizeContentType(value:unknown):"social_posts"|"reel_script"|null;
export function keyExcerpt(document:string,limit?:number):string;
