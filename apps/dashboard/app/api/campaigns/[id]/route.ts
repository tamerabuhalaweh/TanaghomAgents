import type { NextRequest } from "next/server";

import { CampaignRequestError, getCampaign, reviseCampaign } from "@/lib/server/campaign-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return noStore(await getCampaign(request, id));
  } catch (error) {
    if (error instanceof CampaignRequestError) return noStore({ error: error.code }, { status: error.status });
    return apiFailure(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return await reviseCampaign(request, id);
  } catch (error) {
    if (error instanceof CampaignRequestError) return noStore({ error: error.code }, { status: error.status });
    return apiFailure(error);
  }
}
