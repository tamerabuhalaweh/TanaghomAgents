import type { NextRequest } from "next/server";

import { hasValidSameOrigin } from "@/lib/server/auth";
import { noStore } from "@/lib/server/responses";
import { ACCESS_COOKIE, clearSessionCookies } from "@/lib/server/session-cookies";

export const runtime = "nodejs";

const POLICY_CODES = new Set([
  "password_required",
  "password_too_short",
  "password_too_long",
  "password_too_simple",
  "password_too_common",
  "password_contains_email",
  "password_reused",
  "invalid_current_password",
  "current_and_new_password_required",
  "current_password_required",
]);

export async function POST(request: NextRequest) {
  if (!hasValidSameOrigin(request)) {
    return noStore({ error: "invalid_origin" }, { status: 403 });
  }

  let body: { current_password?: unknown; new_password?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "invalid_request" }, { status: 400 });
  }
  const currentPassword = typeof body.current_password === "string" ? body.current_password : "";
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  if (!currentPassword || !newPassword || currentPassword.length > 512 || newPassword.length > 512) {
    return noStore({ error: "current_and_new_password_required" }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return noStore({ error: "authentication_not_configured" }, { status: 503 });
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    || request.cookies.get(ACCESS_COOKIE)?.value
    || "";
  if (!bearer) {
    const response = noStore({ error: "session_expired" }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${supabaseUrl}/auth/v1/password`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return noStore({ error: "authentication_unavailable" }, { status: 503 });
  }

  const payload = await upstream.json().catch(() => ({})) as { error?: string };
  if (upstream.ok) {
    // The server revoked every refresh token for this account, so the browser
    // must authenticate again with the new password.
    const response = noStore({ ok: true, reauthenticate: true });
    clearSessionCookies(response);
    return response;
  }
  if (upstream.status === 429) {
    const retryAfter = Number(upstream.headers.get("retry-after")) || 0;
    return noStore(
      { error: "too_many_attempts", retry_after: retryAfter },
      { status: 429, headers: retryAfter > 0 ? { "Retry-After": String(retryAfter) } : undefined },
    );
  }
  if (upstream.status === 401) {
    const response = noStore({ error: "session_expired" }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }
  if (upstream.status === 400 && payload.error && POLICY_CODES.has(payload.error)) {
    return noStore({ error: payload.error }, { status: 400 });
  }
  return noStore({ error: "password_change_failed" }, { status: 502 });
}
