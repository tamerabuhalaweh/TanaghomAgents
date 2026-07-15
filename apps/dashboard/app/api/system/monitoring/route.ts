import type { NextRequest } from "next/server";

import { apiFailure, noStore } from "@/lib/server/responses";
import { getSystemMonitoring } from "@/lib/server/system-monitoring";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try { return noStore(await getSystemMonitoring(request)); }
  catch (error) { return apiFailure(error); }
}
