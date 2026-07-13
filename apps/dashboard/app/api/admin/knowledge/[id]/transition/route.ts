import type { NextRequest } from "next/server";

import {
  KnowledgeRequestError,
  transitionKnowledge,
} from "@/lib/server/knowledge-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return noStore(await transitionKnowledge(request, id));
  } catch (error) {
    if (error instanceof KnowledgeRequestError) return noStore({ error: error.code }, { status: error.status });
    return apiFailure(error);
  }
}
