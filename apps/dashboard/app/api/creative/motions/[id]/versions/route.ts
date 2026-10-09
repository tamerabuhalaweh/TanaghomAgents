import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { createMotionVersion } from "@/lib/server/creative/motions";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await createMotionVersion(request, id);
  } catch (error) { return apiFailure(error); }
}
