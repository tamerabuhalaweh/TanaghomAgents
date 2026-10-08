import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { createDesign, listDesigns } from "@/lib/server/creative/designs";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return await listDesigns(request);
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest) {
  try {
    return await createDesign(request);
  } catch (error) { return apiFailure(error); }
}
