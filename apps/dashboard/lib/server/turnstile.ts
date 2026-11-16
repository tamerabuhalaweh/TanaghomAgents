import { readFileSync } from "node:fs";

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "sharklasers.com",
  "trashmail.com",
  "getnada.com",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "throwawaymail.com",
]);

export function isDisposableEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return false;
  const domain = normalized.slice(at + 1);
  return [...DISPOSABLE_DOMAINS].some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

/** Compose appends the trusted proxy hop on the right; use that hop only. */
export function rightmostForwardedIp(value: string | null | undefined) {
  const hops = (value || "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1) || null;
}

function turnstileSecret() {
  const direct = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (direct) return direct;
  const file = process.env.TURNSTILE_SECRET_KEY_FILE?.trim() || "/run/secrets/turnstile_secret_key";
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

export type TurnstileVerification = { ok: true; skipped: true } | { ok: boolean; skipped?: false };

export async function verifyTurnstileToken(
  token: unknown,
  remoteIp?: string | null,
): Promise<TurnstileVerification> {
  const secret = turnstileSecret();
  if (!secret) return { ok: true, skipped: true };
  if (typeof token !== "string" || !token.trim()) return { ok: false };
  const form = new URLSearchParams({ secret, response: token.trim() });
  if (remoteIp) form.set("remoteip", remoteIp);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false };
    const result = await response.json().catch(() => null) as { success?: unknown } | null;
    return { ok: Boolean(result?.success) };
  } catch {
    return { ok: false };
  }
}
