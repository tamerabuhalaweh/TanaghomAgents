import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { getCreativeAssetVersion } from "@/lib/server/creative/assets";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await getCreativeAssetVersion(request, id);
  } catch (error) { return apiFailure(error); }
}
