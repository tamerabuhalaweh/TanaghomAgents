import type { NextRequest } from "next/server";

import { automationApiError, updateGhlActionAutomation } from "@/lib/server/automation-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  try { return noStore(await updateGhlActionAutomation(request)); }
  catch (error) {
    const known = automationApiError(error);
    return known ? noStore({ error: known.code }, { status: known.status }) : apiFailure(error);
  }
}
