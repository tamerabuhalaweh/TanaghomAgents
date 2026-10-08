import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { getDesign } from "@/lib/server/creative/designs";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await getDesign(request, id);
  } catch (error) { return apiFailure(error); }
}
