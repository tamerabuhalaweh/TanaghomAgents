import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/responses";
import { clearSessionCookies } from "@/lib/server/session-cookies";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return noStore({ error: "invalid_origin" }, { status: 403 });
  }
  const response = noStore({ ok: true });
  clearSessionCookies(response);
  return response;
}
