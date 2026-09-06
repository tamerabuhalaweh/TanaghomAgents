import type { NextRequest } from "next/server";
import { pilotFailure, pilotWorker } from "@/lib/server/agency-pilot";
import { noStore } from "@/lib/server/responses";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try { return noStore(await pilotWorker(request)); } catch (error) { return pilotFailure(error); }
}
