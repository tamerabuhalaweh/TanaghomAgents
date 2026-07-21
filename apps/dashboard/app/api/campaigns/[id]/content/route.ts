import type { NextRequest } from "next/server";
import { CampaignRequestError, startCampaignContent } from "@/lib/server/campaign-management";
import { apiFailure, noStore } from "@/lib/server/responses";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; return await startCampaignContent(request, id); }
  catch (error) {
    if (error instanceof CampaignRequestError) return noStore({ error: error.code }, { status: error.status });
    return apiFailure(error);
  }
}
