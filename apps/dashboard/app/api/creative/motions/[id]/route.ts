import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { getMotion } from "@/lib/server/creative/motions";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await getMotion(request, id);
  } catch (error) { return apiFailure(error); }
}
