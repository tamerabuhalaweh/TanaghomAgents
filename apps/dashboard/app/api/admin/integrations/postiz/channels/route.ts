import type { NextRequest } from "next/server";

import { integrationApiError, savePostizMappings } from "@/lib/server/integration-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  try { return noStore(await savePostizMappings(request)); }
  catch (error) {
    const known = integrationApiError(error);
    return known ? noStore({ error: known.message }, { status: known.status }) : apiFailure(error);
  }
}
