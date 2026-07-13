import type { NextRequest } from "next/server";

import { integrationApiError, testIntegration } from "@/lib/server/integration-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try { return noStore(await testIntegration(request, (await context.params).provider)); }
  catch (error) {
    const known = integrationApiError(error);
    return known ? noStore({ error: known.message }, { status: known.status }) : apiFailure(error);
  }
}
