import type { NextRequest } from "next/server";
import { pilotFailure, pilotOwner } from "@/lib/server/agency-pilot";
import { noStore } from "@/lib/server/responses";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { return noStore(await pilotOwner(request)); } catch (error) { return pilotFailure(error); }
}
export const POST = GET;
