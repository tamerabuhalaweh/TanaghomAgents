import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { listVideoJobs } from "@/lib/server/creative/video";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return await listVideoJobs(request);
  } catch (error) { return apiFailure(error); }
}
