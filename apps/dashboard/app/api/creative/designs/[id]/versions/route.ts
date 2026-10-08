import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { createDesignVersion } from "@/lib/server/creative/designs";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await createDesignVersion(request, id);
  } catch (error) { return apiFailure(error); }
}
