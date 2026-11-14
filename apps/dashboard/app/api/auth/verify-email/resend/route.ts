import type { NextRequest } from "next/server";

import { hasValidSameOrigin } from "@/lib/server/auth";
import { authUpstreamPayload, postAuthEmail, retryAfterSeconds } from "@/lib/server/auth-email";
import { noStore } from "@/lib/server/responses";
import { ACCESS_COOKIE } from "@/lib/server/session-cookies";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!request.headers.has("authorization") && !hasValidSameOrigin(request)) {
    return noStore({ error: "invalid_origin" }, { status: 403 });
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    || request.cookies.get(ACCESS_COOKIE)?.value
    || "";
  if (!bearer) return noStore({ error: "authentication_required" }, { status: 401 });

  let upstream: Response | null;
  try {
    upstream = await postAuthEmail(request, "/auth/v1/verify-email/resend", {}, { bearer });
  } catch {
    return noStore({ error: "authentication_unavailable" }, { status: 503 });
  }
  if (!upstream) return noStore({ error: "authentication_not_configured" }, { status: 503 });
  const payload = await authUpstreamPayload(upstream);
  if (!upstream.ok) {
    if (upstream.status === 429) {
      const retryAfter = retryAfterSeconds(upstream);
      return noStore(
        { error: "too_many_attempts", retry_after: retryAfter },
        { status: 429, headers: retryAfter > 0 ? { "Retry-After": String(retryAfter) } : undefined },
      );
    }
    if (upstream.status === 401) return noStore({ error: "authentication_required" }, { status: 401 });
    return noStore({ error: "verification_email_failed" }, { status: 503 });
  }
  return noStore(payload);
}
