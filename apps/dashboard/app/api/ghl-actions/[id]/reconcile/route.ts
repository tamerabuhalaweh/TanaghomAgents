import type { NextRequest } from "next/server";
import { GhlActionReviewError, reconcileGhlAction } from "@/lib/server/ghl-action-review";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; return noStore(await reconcileGhlAction(request, id)); }
  catch (error) {
    if (error instanceof GhlActionReviewError) return noStore({ error: error.code }, { status: error.status });
    return apiFailure(error);
  }
}
