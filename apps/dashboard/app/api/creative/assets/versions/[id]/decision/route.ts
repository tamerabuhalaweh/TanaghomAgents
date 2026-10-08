import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { decideCreativeAssetVersion } from "@/lib/server/creative/assets";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await decideCreativeAssetVersion(request, id);
  } catch (error) { return apiFailure(error); }
}
