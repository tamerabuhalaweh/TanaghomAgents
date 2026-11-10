import type { NextRequest } from "next/server";
import { hasValidSameOrigin } from "@/lib/server/auth";
import { noStore } from "@/lib/server/responses";
import { clearSessionCookies, REFRESH_COOKIE } from "@/lib/server/session-cookies";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasValidSameOrigin(request)) {
    return noStore({ error: "invalid_origin" }, { status: 403 });
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (refreshToken && supabaseUrl && publishableKey) {
    try {
      await fetch(`${supabaseUrl}/auth/v1/token?grant_type=logout`, {
        method: "POST",
        headers: { apikey: publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Clearing the cookies is still the safe outcome; the refresh token
      // expires by idle timeout even if the revocation call failed.
    }
  }

  const response = noStore({ ok: true });
  clearSessionCookies(response);
  return response;
}
