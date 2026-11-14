import type { NextRequest } from "next/server";

import { hasValidSameOrigin } from "@/lib/server/auth";
import { authUpstreamPayload, postAuthEmail, retryAfterSeconds } from "@/lib/server/auth-email";
import { noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasValidSameOrigin(request)) return noStore({ error: "invalid_origin" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return noStore({ error: "invalid_request" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";
  if (!email) return noStore({ error: "email_required" }, { status: 400 });

  let upstream: Response | null;
  try {
    upstream = await postAuthEmail(request, "/auth/v1/forgot-password", { email });
  } catch {
    return noStore({ error: "authentication_unavailable" }, { status: 503 });
  }
  if (!upstream) return noStore({ error: "authentication_not_configured" }, { status: 503 });
  const payload = await authUpstreamPayload(upstream);
  if (upstream.ok) return noStore(payload);
  if (upstream.status === 429) {
    const retryAfter = retryAfterSeconds(upstream);
    return noStore(
      { error: "too_many_attempts", retry_after: retryAfter },
      { status: 429, headers: retryAfter > 0 ? { "Retry-After": String(retryAfter) } : undefined },
    );
  }
  return noStore({ error: "password_reset_unavailable" }, { status: 503 });
}
