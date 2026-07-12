import "server-only";

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { NextRequest } from "next/server";

export class AuthenticationError extends Error {}

let cachedJwksUrl: string | undefined;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function authConfiguration() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!supabaseUrl) throw new AuthenticationError("Authentication is not configured");

  return {
    issuer: `${supabaseUrl}/auth/v1`,
    jwksUrl:
      process.env.SUPABASE_JWKS_URL ||
      `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
  };
}

function requestToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1];
  const cookieToken = request.cookies.get("tanaghom_access_token")?.value;
  if (cookieToken) return cookieToken;
  throw new AuthenticationError("Session token required");
}

export function hasValidSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const accepted = new Set([request.nextUrl.origin]);
  const host = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim()
    || request.headers.get("host");
  if (host) {
    const protocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim()
      || request.nextUrl.protocol.replace(":", "");
    accepted.add(`${protocol}://${host}`);
  }
  return accepted.has(origin);
}

export function enforceSameOriginForCookieMutation(request: NextRequest) {
  if (request.headers.has("authorization")) return;
  if (!hasValidSameOrigin(request)) {
    throw new AuthenticationError("Cookie-authenticated mutation requires a same-origin request");
  }
}

export async function authenticate(request: NextRequest): Promise<JWTPayload & { sub: string }> {
  try {
    const configuration = authConfiguration();
    if (!cachedJwks || cachedJwksUrl !== configuration.jwksUrl) {
      cachedJwksUrl = configuration.jwksUrl;
      cachedJwks = createRemoteJWKSet(new URL(configuration.jwksUrl));
    }

    const { payload } = await jwtVerify(requestToken(request), cachedJwks, {
      issuer: configuration.issuer,
      audience: "authenticated",
    });

    if (!payload.sub || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) {
      throw new AuthenticationError("Token subject is invalid");
    }

    return payload as JWTPayload & { sub: string };
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError("Token verification failed");
  }
}
