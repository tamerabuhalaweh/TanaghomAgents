import type { NextRequest } from "next/server";
import { authorize } from "@/lib/server/authorization";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
    return noStore({ user });
  } catch (error) {
    return apiFailure(error);
  }
}
