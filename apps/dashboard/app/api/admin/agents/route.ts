import type { NextRequest } from "next/server";

import {
  AgentStudioRequestError,
  createAgentDraft,
  listAgentStudio,
} from "@/lib/server/agent-studio";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return noStore(await listAgentStudio(request));
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return noStore(await createAgentDraft(request), { status: 201 });
  } catch (error) {
    if (error instanceof AgentStudioRequestError) {
      return noStore({ error: error.code, details: error.details }, { status: error.status });
    }
    return apiFailure(error);
  }
}
