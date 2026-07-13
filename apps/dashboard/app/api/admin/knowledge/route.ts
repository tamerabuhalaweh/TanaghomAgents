import type { NextRequest } from "next/server";

import {
  createKnowledgeDraft,
  KnowledgeRequestError,
  listKnowledge,
} from "@/lib/server/knowledge-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try { return noStore(await listKnowledge(request)); }
  catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest) {
  try { return noStore(await createKnowledgeDraft(request), { status: 201 }); }
  catch (error) {
    if (error instanceof KnowledgeRequestError) return noStore({ error: error.code }, { status: error.status });
    return apiFailure(error);
  }
}
