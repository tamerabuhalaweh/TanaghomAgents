import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { listImagePresets } from "@/lib/server/creative/product";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return await listImagePresets(request);
  } catch (error) { return apiFailure(error); }
}
