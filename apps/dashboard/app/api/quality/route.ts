import type { NextRequest } from "next/server";

import { getQualityRollout, QualityRolloutError, updateQualityEvidence, updateQualityRollout } from "@/lib/server/quality-rollout";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

function failure(error: unknown) {
  return error instanceof QualityRolloutError
    ? noStore({ error: error.code }, { status: error.status })
    : apiFailure(error);
}

export async function GET(request: NextRequest) {
  try { return noStore(await getQualityRollout(request)); }
  catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest) {
  try { return noStore(await updateQualityRollout(request)); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try { return noStore(await updateQualityEvidence(request)); }
  catch (error) { return failure(error); }
}
