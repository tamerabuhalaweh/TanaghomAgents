import "server-only";

import type { NextRequest } from "next/server";

export function authEmailConfiguration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function forwardedAddress(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return null;
  // Caddy already replaces this header with the direct peer. Forward the whole
  // value so the auth service can keep its rightmost-address rule.
  return forwarded.slice(0, 200);
}

export async function postAuthEmail(
  request: NextRequest,
  path: string,
  body: Record<string, unknown>,
  { bearer, timeoutMs = 12_000 }: { bearer?: string; timeoutMs?: number } = {},
) {
  const configuration = authEmailConfiguration();
  if (!configuration) return null;
  const address = forwardedAddress(request);
  return fetch(`${configuration.url}${path}`, {
    method: "POST",
    headers: {
      apikey: configuration.publishableKey,
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(address ? { "x-forwarded-for": address } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function authUpstreamPayload(upstream: Response) {
  return upstream.json().catch(() => ({})) as Promise<{ error?: string; [key: string]: unknown }>;
}

export function retryAfterSeconds(upstream: Response) {
  return Number(upstream.headers.get("retry-after")) || 0;
}
