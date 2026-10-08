import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { getBrandKit } from "@/lib/server/creative/brands";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await getBrandKit(request, id);
  } catch (error) { return apiFailure(error); }
}
