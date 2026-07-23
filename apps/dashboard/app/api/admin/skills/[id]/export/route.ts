import type { NextRequest } from "next/server";

import {
  exportSkillVersion,
  SkillLibraryRequestError,
} from "@/lib/server/skill-library";
import { apiFailure } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const exported = await exportSkillVersion(request, id);
    return new Response(exported.content, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof SkillLibraryRequestError) {
      return Response.json({ error: error.code, details: error.details }, { status: error.status });
    }
    return apiFailure(error);
  }
}
