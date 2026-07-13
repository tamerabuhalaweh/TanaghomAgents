import type { NextRequest } from "next/server";
import { listSupervisorConversations } from "@/lib/server/conversation-supervision";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { return noStore(await listSupervisorConversations(request)); }
  catch (error) { return apiFailure(error); }
}
