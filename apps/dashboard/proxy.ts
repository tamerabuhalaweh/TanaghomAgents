import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const authenticated = request.cookies.has("tanaghom_access_token");
  const loginRoute = request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/accept-invite";

  if (!authenticated && !loginRoute) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
