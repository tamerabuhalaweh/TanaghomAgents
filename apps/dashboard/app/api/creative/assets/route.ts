import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { listCreativeAssets } from "@/lib/server/creative/assets";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return await listCreativeAssets(request);
  } catch (error) { return apiFailure(error); }
}
