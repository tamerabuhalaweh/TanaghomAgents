import type { NextRequest } from "next/server";

import { decideContent } from "@/lib/server/content-decision";
import { apiFailure } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return await decideContent(request, id);
  } catch (error) {
    return apiFailure(error);
  }
}
