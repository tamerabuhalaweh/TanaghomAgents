import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/responses";

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
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: body.email.trim(), password: body.password }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return noStore({ error: "authentication_unavailable" }, { status: 503 });
  }
  if (!upstream.ok) {
    const invalidCredentials = upstream.status === 400 || upstream.status === 401;
    return noStore({ error: invalidCredentials ? "invalid_credentials" : "authentication_unavailable" }, {
      status: invalidCredentials ? 401 : 503,
    });
  }

  const session = await upstream.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const response = noStore({ ok: true });
  const secure = process.env.APP_ENV === "production";
  response.cookies.set("tanaghom_access_token", session.access_token, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: session.expires_in,
  });
  response.cookies.set("tanaghom_refresh_token", session.refresh_token, {
    httpOnly: true, secure, sameSite: "strict", path: "/api/auth", maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
