import type { NextRequest } from "next/server";

import { CampaignRequestError, createCampaign, listCampaigns } from "@/lib/server/campaign-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try { return noStore(await listCampaigns(request)); }
  catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest) {
  try { return await createCampaign(request); }
  catch (error) {
    if (error instanceof CampaignRequestError) return noStore({ error: error.code }, { status: error.status });
    return apiFailure(error);
  }
}
