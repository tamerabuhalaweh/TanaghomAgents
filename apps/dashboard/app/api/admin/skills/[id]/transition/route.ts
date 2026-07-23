import type { NextRequest } from "next/server";

import {
  SkillLibraryRequestError,
  transitionSkillVersion,
} from "@/lib/server/skill-library";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return noStore(await transitionSkillVersion(request, id));
  } catch (error) {
    if (error instanceof SkillLibraryRequestError) {
      return noStore({ error: error.code, details: error.details }, { status: error.status });
    }
    return apiFailure(error);
  }
}
