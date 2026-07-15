import type { NextRequest } from "next/server";
import { listGhlActionReview } from "@/lib/server/ghl-action-review";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { return noStore(await listGhlActionReview(request)); }
  catch (error) { return apiFailure(error); }
}
