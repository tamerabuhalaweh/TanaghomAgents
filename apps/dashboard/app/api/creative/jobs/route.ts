import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { enqueueCreativeJob } from "@/lib/server/creative/jobs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    return await enqueueCreativeJob(request);
  } catch (error) { return apiFailure(error); }
}
