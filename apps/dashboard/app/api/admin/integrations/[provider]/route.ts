import type { NextRequest } from "next/server";

import {
  disconnectIntegration,
  integrationApiError,
  saveIntegration,
} from "@/lib/server/integration-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

function failure(error: unknown) {
  const known = integrationApiError(error);
  return known ? noStore({ error: known.message }, { status: known.status }) : apiFailure(error);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try { return noStore(await saveIntegration(request, (await context.params).provider)); }
  catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try { return noStore(await disconnectIntegration(request, (await context.params).provider)); }
  catch (error) { return failure(error); }
}
