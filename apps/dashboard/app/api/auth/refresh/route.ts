import type { NextRequest } from "next/server";
import { hasValidSameOrigin } from "@/lib/server/auth";
import { noStore } from "@/lib/server/responses";
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from "@/lib/server/session-cookies";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasValidSameOrigin(request)) {
    return noStore({ error: "invalid_origin" }, { status: 403 });
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    const response = noStore({ error: "session_expired" }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return noStore({ error: "authentication_not_configured" }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return noStore({ error: "authentication_unavailable" }, { status: 503 });
  }

  if (!upstream.ok) {
    const invalidSession = upstream.status === 400 || upstream.status === 401;
    const response = noStore(
      { error: invalidSession ? "session_expired" : "authentication_unavailable" },
      { status: invalidSession ? 401 : 503 },
    );
    if (invalidSession) clearSessionCookies(response);
    return response;
  }

  const session = await upstream.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  if (!session.access_token || !session.refresh_token) {
    return noStore({ error: "authentication_unavailable" }, { status: 503 });
  }
  const response = noStore({ ok: true });
  setSessionCookies(response, session);
  return response;
}
