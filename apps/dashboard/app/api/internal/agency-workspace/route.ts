import type { NextRequest } from "next/server";
import { workspaceTick,WorkspaceError } from "@/lib/server/agency-workspace";
import { noStore } from "@/lib/server/responses";
export const runtime="nodejs";
export async function POST(request:NextRequest){try{return noStore(await workspaceTick(request));}catch(error){return noStore({error:error instanceof WorkspaceError?error.code:"workspace_tick_failed"},{status:error instanceof WorkspaceError?error.status:409});}}
