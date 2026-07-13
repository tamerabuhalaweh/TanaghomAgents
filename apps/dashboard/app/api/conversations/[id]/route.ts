import type { NextRequest } from "next/server";
import { ConversationRequestError, getSupervisorConversation } from "@/lib/server/conversation-supervision";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; return noStore(await getSupervisorConversation(request, id)); }
  catch (error) {
    if (error instanceof ConversationRequestError) return noStore({ error: error.code }, { status: error.status });
    return apiFailure(error);
  }
}
