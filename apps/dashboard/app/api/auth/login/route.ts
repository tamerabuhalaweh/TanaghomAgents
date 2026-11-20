import type { NextRequest } from "next/server";
import {
  clearAuthFailures,
  recordAuthFailure,
  requiresTurnstileChallenge,
} from "@/lib/server/auth-rate-limit";
import { noStore } from "@/lib/server/responses";
import { setSessionCookies } from "@/lib/server/session-cookies";
import { isTurnstileConfigured, rightmostForwardedIp, verifyTurnstileToken } from "@/lib/server/turnstile";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return noStore({ error: "authentication_not_configured" }, { status: 503 });
  }

  let body: { email?: unknown; password?: unknown; turnstile_token?: unknown; cf_turnstile_token?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return noStore({ error: "invalid_request" }, { status: 400 });
  }

  const email = body.email.trim();
  const clientIp = rightmostForwardedIp(request.headers.get("x-forwarded-for"));
  const challengeRequired = requiresTurnstileChallenge("login", clientIp, email);
  if (challengeRequired && isTurnstileConfigured()) {
    const token = body.turnstile_token ?? body.cf_turnstile_token;
    if (typeof token !== "string" || !token.trim()) {
      return noStore({ error: "captcha_required", captcha_required: true }, { status: 400 });
    }
    const verified = await verifyTurnstileToken(token, clientIp);
    if (!verified.ok) {
      return noStore({ error: "captcha_verification_failed", captcha_required: true }, { status: 400 });
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        // Preserve the real client address and browser User-Agent for rate limits and session device labels.
        ...(request.headers.get("x-forwarded-for")
          ? { "x-forwarded-for": request.headers.get("x-forwarded-for")! }
          : {}),
        ...(request.headers.get("user-agent")
          ? { "user-agent": request.headers.get("user-agent")! }
          : {}),
      },
      body: JSON.stringify({ email, password: body.password }),
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
    if (upstream.status === 403) {
      const failure = await upstream.json().catch(() => ({})) as { error?: string };
      if (failure.error === "email_not_verified") {
        return noStore({ error: "email_not_verified" }, { status: 403 });
      }
    }
    const invalidCredentials = upstream.status === 400 || upstream.status === 401;
    if (invalidCredentials) {
      recordAuthFailure("login", clientIp, email);
    }
    const nextChallenge = invalidCredentials && requiresTurnstileChallenge("login", clientIp, email);
    return noStore(
      {
        error: invalidCredentials ? "invalid_credentials" : "authentication_unavailable",
        ...(nextChallenge && isTurnstileConfigured() ? { captcha_required: true } : {}),
      },
      { status: invalidCredentials ? 401 : 503 },
    );
  }
  clearAuthFailures("login", clientIp, email);

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
