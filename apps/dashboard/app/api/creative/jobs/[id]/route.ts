import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { getCreativeJob } from "@/lib/server/creative/jobs";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await getCreativeJob(request, id);
  } catch (error) { return apiFailure(error); }
}
