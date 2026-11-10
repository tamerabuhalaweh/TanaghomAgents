import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/responses";
import { setSessionCookies } from "@/lib/server/session-cookies";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return noStore({ error: "authentication_not_configured" }, { status: 503 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return noStore({ error: "invalid_request" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        // Preserve the real client address for the auth service's per-IP limit.
        ...(request.headers.get("x-forwarded-for")
          ? { "x-forwarded-for": request.headers.get("x-forwarded-for")! }
          : {}),
      },
      body: JSON.stringify({ email: body.email.trim(), password: body.password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return noStore({ error: "authentication_unavailable" }, { status: 503 });
  }
  if (!upstream.ok) {
    if (upstream.status === 429) {
      const retryAfter = Number(upstream.headers.get("retry-after")) || 0;
      return noStore(
        { error: "too_many_attempts", retry_after: retryAfter },
        { status: 429, headers: retryAfter > 0 ? { "Retry-After": String(retryAfter) } : undefined },
      );
    }
    const invalidCredentials = upstream.status === 400 || upstream.status === 401;
    return noStore({ error: invalidCredentials ? "invalid_credentials" : "authentication_unavailable" }, {
      status: invalidCredentials ? 401 : 503,
    });
  }

  const session = await upstream.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    must_change_password?: boolean;
  };
  const response = noStore({ ok: true, must_change_password: session.must_change_password === true });
  setSessionCookies(response, session);
  return response;
}
