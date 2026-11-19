import "server-only";

interface WindowBucket {
  count: number;
  resetAt: number;
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_KEYS = 10_000;
const DEFAULT_SIGNUP_IP_LIMIT = 5;
const DEFAULT_SIGNUP_ACCOUNT_LIMIT = 3;
const DEFAULT_TURNSTILE_THRESHOLD = 3;

const buckets = new Map<string, WindowBucket>();

function positiveInt(raw: string | undefined, fallback: number, min = 1, max = 100_000) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function normalizeAddress(address: string | null | undefined) {
  return (address || "unknown").trim().toLowerCase().slice(0, 128) || "unknown";
}

function normalizeEmail(email: string | null | undefined) {
  return (email || "").trim().toLowerCase().slice(0, 320);
}

function activeBucket(key: string, now: number): WindowBucket | null {
  const existing = buckets.get(key);
  if (!existing) return null;
  if (existing.resetAt <= now) {
    buckets.delete(key);
    return null;
  }
  return existing;
}

function putBucket(key: string, bucket: WindowBucket, now: number) {
  const maxKeys = positiveInt(process.env.AUTH_RATE_LIMIT_MAX_KEYS, DEFAULT_MAX_KEYS, 100, 100_000);
  if (!buckets.has(key) && buckets.size >= maxKeys) {
    for (const [candidate, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(candidate);
    }
    while (buckets.size >= maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }
  buckets.set(key, bucket);
}

function increment(key: string, windowMs: number, now: number): WindowBucket {
  const current = activeBucket(key, now);
  if (current) {
    current.count += 1;
    return current;
  }
  const fresh: WindowBucket = { count: 1, resetAt: now + windowMs };
  putBucket(key, fresh, now);
  return fresh;
}

function retryAfterFor(keys: Array<[string, number]>, now: number): number {
  let retryAfter = 0;
  for (const [key, limit] of keys) {
    const entry = activeBucket(key, now);
    if (entry && entry.count >= limit) {
      retryAfter = Math.max(retryAfter, Math.ceil((entry.resetAt - now) / 1000));
    }
  }
  return retryAfter;
}

export function signupRateLimitConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    ipLimit: positiveInt(env.AUTH_SIGNUP_IP_LIMIT, DEFAULT_SIGNUP_IP_LIMIT, 1, 500),
    accountLimit: positiveInt(env.AUTH_SIGNUP_ACCOUNT_LIMIT, DEFAULT_SIGNUP_ACCOUNT_LIMIT, 1, 100),
    windowMs: DEFAULT_WINDOW_MS,
  };
}

export function turnstileFailureThreshold(env: NodeJS.ProcessEnv = process.env) {
  return positiveInt(env.AUTH_TURNSTILE_FAILURE_THRESHOLD, DEFAULT_TURNSTILE_THRESHOLD, 1, 20);
}

/**
 * Enforces both per-IP and per-account (normalized email) signup rate limits
 * before hitting the upstream auth service.
 */
export function checkAndRecordSignupAttempt(
  address: string | null | undefined,
  email: string | null | undefined,
  now = Date.now(),
): { allowed: true } | { allowed: false; retryAfter: number } {
  const ip = normalizeAddress(address);
  const account = normalizeEmail(email);
  const { ipLimit, accountLimit, windowMs } = signupRateLimitConfig();
  const keys: Array<[string, number]> = [[`signup:ip:${ip}`, ipLimit]];
  if (account) keys.push([`signup:account:${account}`, accountLimit]);

  const retryAfter = retryAfterFor(keys, now);
  if (retryAfter > 0) return { allowed: false, retryAfter };

  for (const [key] of keys) increment(key, windowMs, now);
  return { allowed: true };
}

export function recordAuthFailure(
  scope: "login" | "signup",
  address: string | null | undefined,
  email: string | null | undefined,
  now = Date.now(),
) {
  const ip = normalizeAddress(address);
  const account = normalizeEmail(email);
  const ipBucket = increment(`fail:${scope}:ip:${ip}`, DEFAULT_WINDOW_MS, now);
  const pairBucket = account ? increment(`fail:${scope}:pair:${ip}:${account}`, DEFAULT_WINDOW_MS, now) : null;
  return Math.max(ipBucket.count, pairBucket?.count ?? 0);
}

export function authFailureCount(
  scope: "login" | "signup",
  address: string | null | undefined,
  email: string | null | undefined,
  now = Date.now(),
) {
  const ip = normalizeAddress(address);
  const account = normalizeEmail(email);
  const ipCount = activeBucket(`fail:${scope}:ip:${ip}`, now)?.count ?? 0;
  const pairCount = account ? (activeBucket(`fail:${scope}:pair:${ip}:${account}`, now)?.count ?? 0) : 0;
  return Math.max(ipCount, pairCount);
}

export function requiresTurnstileChallenge(
  scope: "login" | "signup",
  address: string | null | undefined,
  email: string | null | undefined,
  now = Date.now(),
) {
  return authFailureCount(scope, address, email, now) >= turnstileFailureThreshold();
}

export function clearAuthFailures(
  scope: "login" | "signup",
  address: string | null | undefined,
  email: string | null | undefined,
) {
  const ip = normalizeAddress(address);
  const account = normalizeEmail(email);
  if (account) buckets.delete(`fail:${scope}:pair:${ip}:${account}`);
}

export function resetAuthRateLimits() {
  buckets.clear();
}
