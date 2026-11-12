import { NextResponse, type NextRequest } from "next/server";

// Public entry points. Everything else is gated here optimistically (cookie
// presence); the API and server components still verify the session row and the
// tenant membership through `authorize`/`requireTenant`.
const PUBLIC_PAGES = new Set([
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
]);

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const authenticated = request.cookies.has("tanaghom_access_token");
  const publicPage = PUBLIC_PAGES.has(pathname);

  if (!authenticated && !publicPage) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
