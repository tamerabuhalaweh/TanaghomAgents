import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { createBrandKitVersion } from "@/lib/server/creative/brands";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await createBrandKitVersion(request, id);
  } catch (error) { return apiFailure(error); }
}
