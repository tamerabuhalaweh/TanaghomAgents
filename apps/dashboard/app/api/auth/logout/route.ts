import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return noStore({ error: "invalid_origin" }, { status: 403 });
  }
  const response = noStore({ ok: true });
  response.cookies.set("tanaghom_access_token", "", { httpOnly: true, maxAge: 0, path: "/" });
  response.cookies.set("tanaghom_refresh_token", "", { httpOnly: true, maxAge: 0, path: "/api/auth" });
  return response;
}
