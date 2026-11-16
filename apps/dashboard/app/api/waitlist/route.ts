import type { NextRequest } from "next/server";

import { database } from "@/lib/server/database";
import { joinWaitlist, lockLaunchControl } from "@/lib/server/launch-control";
import { noStore } from "@/lib/server/responses";
import { isDisposableEmail, rightmostForwardedIp, verifyTurnstileToken } from "@/lib/server/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_KEYS = 2_000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function sourceKey(request: NextRequest) {
  const forwarded = rightmostForwardedIp(request.headers.get("x-forwarded-for"));
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function rateLimited(key: string) {
  const now = Date.now();
  if (attempts.size > MAX_KEYS) {
    for (const [candidate, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(candidate);
    }
    while (attempts.size > MAX_KEYS) attempts.delete(attempts.keys().next().value as string);
  }
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_ATTEMPTS;
}

export async function POST(request: NextRequest) {
  try {
    if (rateLimited(sourceKey(request))) {
      return noStore({ error: "too_many_requests" }, { status: 429 });
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return noStore({ error: "payload_too_large" }, { status: 413 });
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return noStore({ error: "invalid_request" }, { status: 400 });
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const companyName = typeof body.company_name === "string" ? body.company_name.trim() : "";
    const locale = body.locale === "ar" ? "ar" : "en";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return noStore({ error: "waitlist_email_invalid" }, { status: 400 });
    }
    if (companyName.length > 160) {
      return noStore({ error: "waitlist_company_invalid" }, { status: 400 });
    }
    if (isDisposableEmail(email)) {
      return noStore({ error: "disposable_email_not_allowed" }, { status: 400 });
    }
    const captcha = await verifyTurnstileToken(
      body.turnstile_token ?? body.cf_turnstile_token,
      rightmostForwardedIp(request.headers.get("x-forwarded-for")),
    );
    if (!captcha.ok) {
      return noStore({ error: "captcha_verification_failed" }, { status: 400 });
    }
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await lockLaunchControl(client);
      const joined = await joinWaitlist(client, {
        email,
        companyName,
        locale,
      });
      await client.query("COMMIT");
      return noStore({
        ok: true,
        queue_position: joined.queue_position,
        already_joined: joined.already_joined,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "waitlist_email_invalid") {
      return noStore({ error: "waitlist_email_invalid" }, { status: 400 });
    }
    console.error("Tanaghom waitlist request failed", error);
    return noStore({ error: "service_unavailable" }, { status: 503 });
  }
}
