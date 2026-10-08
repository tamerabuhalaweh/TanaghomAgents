import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { setCreativeTemplateActive } from "@/lib/server/creative/templates";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await setCreativeTemplateActive(request, id);
  } catch (error) { return apiFailure(error); }
}
