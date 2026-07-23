import type { NextRequest } from "next/server";

import {
  createSkillDraft,
  listSkillLibrary,
  SkillLibraryRequestError,
} from "@/lib/server/skill-library";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try { return noStore(await listSkillLibrary(request)); }
  catch (error) { return apiFailure(error); }
}

export async function POST(request: NextRequest) {
  try { return noStore(await createSkillDraft(request), { status: 201 }); }
  catch (error) {
    if (error instanceof SkillLibraryRequestError) {
      return noStore({ error: error.code, details: error.details }, { status: error.status });
    }
    return apiFailure(error);
  }
}
