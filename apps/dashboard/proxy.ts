import { NextResponse, type NextRequest } from "next/server";

import { buildGlobalCspHeader } from "@/lib/server/csp";

// Public entry points. Everything else is gated here optimistically (cookie
// presence); the API and server components still verify the session row and the
// tenant membership through `authorize`/`requireTenant`.
const PUBLIC_PAGES = new Set([
  "/",
  "/pricing",
  "/privacy",
  "/terms",
  "/blog/ai-social-media-manager-small-business",
  "/blog/ai-social-media-management-small-business",
  "/opengraph-image",
  "/twitter-image",
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/super-admin",
]);

function applyGlobalCsp(response: NextResponse) {
  const policy = buildGlobalCspHeader();
  if (policy) response.headers.set(policy.header, policy.value);
  return response;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const authenticated = request.cookies.has("tanaghom_access_token");
  const publicPage = PUBLIC_PAGES.has(pathname);

  if (!authenticated && !publicPage) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return applyGlobalCsp(NextResponse.redirect(login));
  }

  return applyGlobalCsp(NextResponse.next());
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
