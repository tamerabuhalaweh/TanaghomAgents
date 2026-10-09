import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { requestMotionRender } from "@/lib/server/creative/motion-render";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await requestMotionRender(request, id);
  } catch (error) { return apiFailure(error); }
}
