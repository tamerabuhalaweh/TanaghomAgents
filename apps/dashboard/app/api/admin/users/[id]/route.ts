import type { NextRequest } from "next/server";

import { apiFailure, noStore } from "@/lib/server/responses";
import { teamApiError, updateTeamMember } from "@/lib/server/team-management";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return noStore(await updateTeamMember(request, id));
  } catch (error) {
    const known = teamApiError(error);
    return known ? noStore({ error: known.code }, { status: known.status }) : apiFailure(error);
  }
}
