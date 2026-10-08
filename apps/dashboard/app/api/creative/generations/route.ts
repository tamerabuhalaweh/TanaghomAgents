import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { submitGeneration } from "@/lib/server/creative/generations";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    return await submitGeneration(request);
  } catch (error) { return apiFailure(error); }
}
