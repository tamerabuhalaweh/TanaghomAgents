import type { NextRequest } from "next/server";

import { apiFailure } from "@/lib/server/responses";
import { getFidelityHistory, recordFidelityReview } from "@/lib/server/creative/fidelity";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await getFidelityHistory(request, id);
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await recordFidelityReview(request, id);
  } catch (error) { return apiFailure(error); }
}
