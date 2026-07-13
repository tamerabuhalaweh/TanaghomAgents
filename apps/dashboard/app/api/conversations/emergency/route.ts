import type { NextRequest } from "next/server";
import { ConversationRequestError, setConversationEmergencyStop } from "@/lib/server/conversation-supervision";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try { return noStore(await setConversationEmergencyStop(request)); }
  catch (error) {
    if (error instanceof ConversationRequestError) return noStore({ error: error.code }, { status: error.status });
    return apiFailure(error);
  }
}
