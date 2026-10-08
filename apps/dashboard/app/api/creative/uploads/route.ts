import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { uploadSourceImage } from "@/lib/server/creative/upload";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    return await uploadSourceImage(request);
  } catch (error) { return apiFailure(error); }
}
