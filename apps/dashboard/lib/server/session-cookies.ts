import type { NextResponse } from "next/server";

export const ACCESS_COOKIE = "tanaghom_access_token";
export const REFRESH_COOKIE = "tanaghom_refresh_token";

interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function secureCookies() {
  return process.env.APP_ENV === "production";
}

export function setSessionCookies(response: NextResponse, session: AuthSession) {
  const secure = secureCookies();
  const accessMaxAge = Number.isFinite(session.expires_in)
    ? Math.max(1, Math.min(Math.floor(session.expires_in), 60 * 60 * 24))
    : 60 * 60;
  response.cookies.set(ACCESS_COOKIE, session.access_token, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: accessMaxAge,
  });
  response.cookies.set(REFRESH_COOKIE, session.refresh_token, {
    httpOnly: true, secure, sameSite: "strict", path: "/api/auth", maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookies(response: NextResponse) {
  const secure = secureCookies();
  response.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true, secure, sameSite: "lax", maxAge: 0, path: "/",
  });
  response.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true, secure, sameSite: "strict", maxAge: 0, path: "/api/auth",
  });
}
