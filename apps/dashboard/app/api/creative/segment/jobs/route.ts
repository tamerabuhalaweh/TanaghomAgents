import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { listSegmentJobs, submitSegmentation } from "@/lib/server/creative/segment";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return await listSegmentJobs(request);
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest) {
  try {
    return await submitSegmentation(request);
  } catch (error) { return apiFailure(error); }
}
