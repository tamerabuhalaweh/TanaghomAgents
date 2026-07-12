import { NextResponse } from "next/server";

import { AuthenticationError } from "@/lib/server/auth";
import { AuthorizationError } from "@/lib/server/authorization";

export function noStore<T>(body: T, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function apiFailure(error: unknown) {
  if (error instanceof AuthenticationError) {
    return noStore({ error: "authentication_required" }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return noStore({ error: "forbidden" }, { status: 403 });
  }

  console.error("Tanaghom API request failed", error);
  return noStore({ error: "service_unavailable" }, { status: 503 });
}
