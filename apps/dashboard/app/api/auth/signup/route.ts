import type { NextRequest } from "next/server";

import { hasValidSameOrigin } from "@/lib/server/auth";
import {
  checkAndRecordSignupAttempt,
  clearAuthFailures,
  recordAuthFailure,
  requiresTurnstileChallenge,
} from "@/lib/server/auth-rate-limit";
import { noStore } from "@/lib/server/responses";
import { setSessionCookies } from "@/lib/server/session-cookies";
import { isDisposableEmail, isTurnstileConfigured, rightmostForwardedIp, verifyTurnstileToken } from "@/lib/server/turnstile";

export const runtime = "nodejs";

const ERROR_STATUS: Record<string, number> = {
  email_taken: 409,
  invalid_email: 400,
  invalid_name: 400,
  invalid_organization: 400,
  password_too_short: 400,
  password_too_long: 400,
  password_too_simple: 400,
  password_too_common: 400,
  password_contains_email: 400,
};

export async function POST(request: NextRequest) {
  // Signup is public, but a cookie-less cross-site form post is not the way a
  // customer reaches it; rejecting foreign origins keeps the CSRF surface flat.
  if (!hasValidSameOrigin(request)) {
    return noStore({ error: "invalid_origin" }, { status: 403 });
  }

  const authUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!authUrl || !publishableKey) {
    return noStore({ error: "authentication_not_configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return noStore({ error: "invalid_request" }, { status: 400 });
  }

  const payload = {
    email: typeof body.email === "string" ? body.email.trim() : "",
    password: typeof body.password === "string" ? body.password : "",
    full_name: typeof body.full_name === "string" ? body.full_name.trim() : "",
    organization_name: typeof body.organization_name === "string" ? body.organization_name.trim() : "",
    locale: body.locale === "ar" ? "ar" : "en",
  };
  const clientIp = rightmostForwardedIp(request.headers.get("x-forwarded-for"));
  if (!payload.email || !payload.password || !payload.full_name || !payload.organization_name) {
    recordAuthFailure("signup", clientIp, payload.email);
    return noStore({ error: "invalid_request" }, { status: 400 });
  }
  const rateLimit = checkAndRecordSignupAttempt(clientIp, payload.email);
  if (!rateLimit.allowed) {
    return noStore(
      { error: "too_many_attempts", retry_after: rateLimit.retryAfter },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }
  if (isDisposableEmail(payload.email)) {
    recordAuthFailure("signup", clientIp, payload.email);
    return noStore({ error: "disposable_email_not_allowed" }, { status: 400 });
  }
  const captchaToken = body.turnstile_token ?? body.cf_turnstile_token;
  const challengeRequired = requiresTurnstileChallenge("signup", clientIp, payload.email);
  if (isTurnstileConfigured() && challengeRequired && (typeof captchaToken !== "string" || !captchaToken.trim())) {
    return noStore({ error: "captcha_required", captcha_required: true }, { status: 400 });
  }
  const captcha = await verifyTurnstileToken(captchaToken, clientIp);
  if (!captcha.ok) {
    recordAuthFailure("signup", clientIp, payload.email);
    return noStore({ error: "captcha_verification_failed", captcha_required: true }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${authUrl}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        ...(request.headers.get("x-forwarded-for")
          ? { "x-forwarded-for": request.headers.get("x-forwarded-for")! }
          : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
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
    const failure = await upstream.json().catch(() => ({})) as { error?: string };
    const status = ERROR_STATUS[failure.error ?? ""] ?? 503;
    if (status === 400 || status === 409) {
      recordAuthFailure("signup", clientIp, payload.email);
    }
    return noStore(
      {
        error: status === 400 || status === 409 ? failure.error : "signup_failed",
        ...(isTurnstileConfigured() && requiresTurnstileChallenge("signup", clientIp, payload.email)
          ? { captcha_required: true }
          : {}),
      },
      { status },
    );
  }
  clearAuthFailures("signup", clientIp, payload.email);

  const session = await upstream.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    organization?: { id: string; name: string; role: string };
  };
  const response = noStore(
    { ok: true, organization: session.organization ?? null },
    { status: 201 },
  );
  setSessionCookies(response, session);
  return response;
}
