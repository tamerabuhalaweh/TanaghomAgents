import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { createBrandKit, listBrandKits } from "@/lib/server/creative/brands";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    return await listBrandKits(request);
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest) {
  try {
    return await createBrandKit(request);
  } catch (error) { return apiFailure(error); }
}
