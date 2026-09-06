import type { NextRequest } from "next/server";
import { workspaceRead,workspaceWrite,WorkspaceError } from "@/lib/server/agency-workspace";
import { apiFailure,noStore } from "@/lib/server/responses";
export const runtime="nodejs";
function fail(error:unknown){if(error instanceof WorkspaceError)return noStore({error:error.code},{status:error.status});return apiFailure(error);}
export async function GET(request:NextRequest){try{return noStore(await workspaceRead(request));}catch(error){return fail(error);}}
export async function POST(request:NextRequest){try{return noStore(await workspaceWrite(request));}catch(error){return fail(error);}}
