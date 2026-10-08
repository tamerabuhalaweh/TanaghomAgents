import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { requestDesignRender } from "@/lib/server/creative/render";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await requestDesignRender(request, id);
  } catch (error) { return apiFailure(error); }
}
