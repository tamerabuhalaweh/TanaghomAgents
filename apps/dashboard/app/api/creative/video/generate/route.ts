import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { submitVideoGeneration } from "@/lib/server/creative/video";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    return await submitVideoGeneration(request);
  } catch (error) { return apiFailure(error); }
}
