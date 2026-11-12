import type { NextRequest } from "next/server";

import { hasValidSameOrigin } from "@/lib/server/auth";
import { noStore } from "@/lib/server/responses";
import { ACCESS_COOKIE } from "@/lib/server/session-cookies";

export const runtime = "nodejs";

function upstreamConfiguration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function forward(request: NextRequest, method: "GET" | "DELETE") {
  const configuration = upstreamConfiguration();
  if (!configuration) {
    return noStore({ error: "authentication_not_configured" }, { status: 503 });
  }
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return noStore({ error: "authentication_required" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  const target = method === "DELETE"
    ? `${configuration.url}/auth/v1/sessions?id=${encodeURIComponent(id ?? "")}`
    : `${configuration.url}/auth/v1/sessions`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: {
        apikey: configuration.key,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return noStore({ error: "authentication_unavailable" }, { status: 503 });
  }

  const payload = await upstream.json().catch(() => ({}));
  return noStore(payload, { status: upstream.status });
}

export async function GET(request: NextRequest) {
  return forward(request, "GET");
}

export async function DELETE(request: NextRequest) {
  if (!hasValidSameOrigin(request)) {
    return noStore({ error: "invalid_origin" }, { status: 403 });
  }
  if (!request.nextUrl.searchParams.get("id")) {
    return noStore({ error: "session_id_required" }, { status: 400 });
  }
  return forward(request, "DELETE");
}
