import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { submitProductScene } from "@/lib/server/creative/product";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    return await submitProductScene(request);
  } catch (error) { return apiFailure(error); }
}
