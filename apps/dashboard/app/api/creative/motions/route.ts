import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { createMotion, listMotions } from "@/lib/server/creative/motions";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return await listMotions(request);
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest) {
  try {
    return await createMotion(request);
  } catch (error) { return apiFailure(error); }
}
