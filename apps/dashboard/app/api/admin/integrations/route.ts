import type { NextRequest } from "next/server";

import { listIntegrations } from "@/lib/server/integration-management";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try { return noStore(await listIntegrations(request)); }
  catch (error) { return apiFailure(error); }
}
