import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { cancelCreativeJob } from "@/lib/server/creative/jobs";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await cancelCreativeJob(request, id);
  } catch (error) { return apiFailure(error); }
}
