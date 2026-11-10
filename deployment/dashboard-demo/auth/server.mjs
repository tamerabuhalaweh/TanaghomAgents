import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  sign,
  verify as verifySignature,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { burnPasswordCheck, hashPassword, passwordPolicyError, verifyPassword } from "./passwords.mjs";
import { createUserStore } from "./store.mjs";

const KEY_FILE = process.env.AUTH_PRIVATE_KEY_FILE ?? "/run/secrets/auth_private_key";
const PORT = Number(process.env.DEMO_AUTH_PORT ?? "43191");
const ISSUER = (process.env.DEMO_AUTH_ISSUER ?? "http://auth:43191/auth/v1").replace(/\/$/, "");
const STORE_FILE = process.env.AUTH_STORE_FILE ?? "/data/auth-users.json";
const SEED_FILE = process.env.AUTH_SEED_FILE ?? "/run/secrets/auth_users";
const MAX_BODY_BYTES = 64 * 1024;

function positiveInt(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`invalid ${name}`);
  return value;
}

// Access tokens are short-lived; the refresh token carries the idle and the
// absolute session lifetime, so a stolen access token is useless quickly and a
// dormant browser tab stops refreshing after the idle window.
const ACCESS_TTL_SECONDS = positiveInt("AUTH_ACCESS_TTL_SECONDS", 900);
const IDLE_TTL_MS = positiveInt("AUTH_IDLE_TTL_SECONDS", 1800) * 1000;
const ABSOLUTE_TTL_MS = positiveInt("AUTH_ABSOLUTE_TTL_SECONDS", 12 * 60 * 60) * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LIMITS = {
  email: positiveInt("AUTH_LOGIN_EMAIL_LIMIT", 5),
  ip: positiveInt("AUTH_LOGIN_IP_LIMIT", 20),
  pair: positiveInt("AUTH_LOGIN_PAIR_LIMIT", 8),
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("invalid demo auth port");
const issuerUrl = new URL(ISSUER);
if (!["http:", "https:"].includes(issuerUrl.protocol) || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) {
  throw new Error("invalid demo auth issuer");
}

function readSecret(path) {
  try {
    const value = readFileSync(path, "utf8");
    if (!value.trim()) throw new Error("empty");
    return value;
  } catch {
    throw new Error(`required demo auth secret unavailable: ${path}`);
  }
}

const store = createUserStore({ file: STORE_FILE, seedFile: SEED_FILE });
await store.load();
if (store.size < 1) throw new Error("auth store must contain at least one account");

const privateKey = createPrivateKey(readSecret(KEY_FILE));
const publicKey = createPublicKey(privateKey);
const publicJwk = publicKey.export({ format: "jwk" });
const keyId = createHash("sha256")
  .update(publicKey.export({ type: "spki", format: "der" }))
  .digest("base64url")
  .slice(0, 16);
const jwks = {
  keys: [{ ...publicJwk, kid: keyId, use: "sig", alg: "RS256" }],
};

// refresh token hash -> session. Tokens are never stored in plaintext.
const sessions = new Map();
// key -> { count, resetAt }
const failures = new Map();

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function compactJson(value) {
  return base64url(JSON.stringify(value));
}

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function mintAccessToken(user, sessionId) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: keyId };
  const payload = {
    iss: ISSUER,
    sub: user.sub,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    session_id: sessionId,
    session_epoch: user.sessionEpoch,
    must_change_password: user.mustChangePassword,
    aal: "aal1",
    iat: issuedAt,
    exp: issuedAt + ACCESS_TTL_SECONDS,
  };
  const signingInput = `${compactJson(header)}.${compactJson(payload)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput, "ascii"), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

function issueSession(user) {
  const sessionId = randomUUID();
  const refreshToken = randomBytes(48).toString("base64url");
  const now = Date.now();
  sessions.set(hashToken(refreshToken), {
    sub: user.sub,
    sessionId,
    epoch: user.sessionEpoch,
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: now + ABSOLUTE_TTL_MS,
  });
  return {
    access_token: mintAccessToken(user, sessionId),
    token_type: "bearer",
    expires_in: ACCESS_TTL_SECONDS,
    expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
    must_change_password: user.mustChangePassword,
  };
}

function revokeSessionsFor(sub) {
  for (const [key, entry] of sessions) {
    if (entry.sub === sub) sessions.delete(key);
  }
}

function verifyAccessToken(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  let valid = false;
  try {
    valid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`, "ascii"),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER || claims.aud !== "authenticated") return null;
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.sub !== "string" || !UUID_RE.test(claims.sub)) return null;
  return claims;
}

function currentFailure(key) {
  const entry = failures.get(key);
  if (!entry) return null;
  if (entry.resetAt <= Date.now()) {
    failures.delete(key);
    return null;
  }
  return entry;
}

function loginBlock(address, email) {
  const pairs = [
    [`email|${email}`, LIMITS.email],
    [`ip|${address}`, LIMITS.ip],
    [`pair|${address}|${email}`, LIMITS.pair],
  ];
  let retryAfter = 0;
  for (const [key, limit] of pairs) {
    const entry = currentFailure(key);
    if (entry && entry.count >= limit) {
      retryAfter = Math.max(retryAfter, Math.ceil((entry.resetAt - Date.now()) / 1000));
    }
  }
  return retryAfter;
}

function noteLoginFailure(address, email) {
  const now = Date.now();
  const keys = [`email|${email}`, `ip|${address}`, `pair|${address}|${email}`];
  for (const key of keys) {
    const entry = currentFailure(key);
    if (!entry) failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    else entry.count += 1;
  }
}

function clearLoginFailures(address, email) {
  failures.delete(`email|${email}`);
  failures.delete(`pair|${address}|${email}`);
}

function send(response, status, body, extraHeaders = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(bytes.length),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(bytes);
}

function sendEmpty(response, status, extraHeaders = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("body_too_large"), { status: 413 }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => reject(Object.assign(new Error("body_read_failed"), { status: 400 })));
  });
}

async function readJson(request) {
  const text = await readBody(request);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value;
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

function addressOf(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length <= 200) {
    const first = forwarded.split(",", 1)[0].trim();
    if (first) return first;
  }
  return request.socket.remoteAddress ?? "unknown";
}

function bearerToken(request) {
  const header = request.headers.authorization;
  const match = typeof header === "string" ? header.match(/^Bearer\s+(.+)$/i) : null;
  return match ? match[1] : null;
}

function requireIdentity(request) {
  const token = bearerToken(request);
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) throw Object.assign(new Error("unauthenticated"), { status: 401, code: "session_expired" });
  const user = store.findBySub(claims.sub);
  if (!user || user.disabled) {
    throw Object.assign(new Error("unauthenticated"), { status: 401, code: "session_expired" });
  }
  if (claims.session_epoch !== user.sessionEpoch) {
    throw Object.assign(new Error("stale_session"), { status: 401, code: "session_revoked" });
  }
  return { claims, user };
}

async function handleToken(request, response) {
  const url = new URL(request.url ?? "/", "http://demo-auth");
  const grantType = url.searchParams.get("grant_type");
  const body = await readJson(request);
  await store.refreshIfChanged();

  if (grantType === "password") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || email.length > 320 || password.length > 512) {
      send(response, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
      return;
    }
    const address = addressOf(request);
    const retryAfter = loginBlock(address, email);
    if (retryAfter > 0) {
      send(response, 429, { error: "too_many_attempts", retry_after: retryAfter }, { "Retry-After": String(retryAfter) });
      return;
    }
    const user = store.findByEmail(email);
    const passwordMatches = user && !user.disabled
      ? await verifyPassword(user.passwordHash, password)
      : await burnPasswordCheck(password);
    if (!user || user.disabled || !passwordMatches) {
      noteLoginFailure(address, email);
      send(response, 401, { error: "invalid_grant", error_description: "Invalid login credentials" });
      return;
    }
    clearLoginFailures(address, email);
    send(response, 200, issueSession(user));
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    const key = refreshToken ? hashToken(refreshToken) : null;
    const entry = key ? sessions.get(key) : null;
    if (!entry) {
      send(response, 401, { error: "invalid_grant", error_description: "Invalid refresh token" });
      return;
    }
    const now = Date.now();
    if (entry.absoluteExpiresAt <= now || now - entry.lastSeenAt > IDLE_TTL_MS) {
      sessions.delete(key);
      send(response, 401, { error: "session_expired", error_description: "Session expired" });
      return;
    }
    const user = store.findBySub(entry.sub);
    if (!user || user.disabled || user.sessionEpoch !== entry.epoch) {
      sessions.delete(key);
      send(response, 401, { error: "session_revoked", error_description: "Session revoked" });
      return;
    }
    sessions.delete(key);
    send(response, 200, issueSession(user));
    return;
  }

  if (grantType === "logout") {
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (refreshToken) sessions.delete(hashToken(refreshToken));
    sendEmpty(response, 204);
    return;
  }

  send(response, 400, { error: "unsupported_grant_type" });
}

async function handleLogout(request, response) {
  await readJson(request).catch(() => ({}));
  const token = request.headers["x-refresh-token"];
  if (typeof token === "string" && token) sessions.delete(hashToken(token));
  sendEmpty(response, 204);
}

async function handlePassword(request, response) {
  let identity;
  try {
    identity = requireIdentity(request);
  } catch (error) {
    send(response, 401, { error: error.code ?? "unauthenticated" });
    return;
  }
  const body = await readJson(request);
  const current = typeof body.current_password === "string" ? body.current_password : "";
  const next = typeof body.new_password === "string" ? body.new_password : "";
  if (!current || !next) {
    send(response, 400, { error: "current_and_new_password_required" });
    return;
  }
  if (!(await verifyPassword(identity.user.passwordHash, current))) {
    send(response, 400, { error: "invalid_current_password" });
    return;
  }
  if (current === next) {
    send(response, 400, { error: "password_reused" });
    return;
  }
  const policy = passwordPolicyError(next, identity.user.email);
  if (policy) {
    send(response, 400, { error: policy });
    return;
  }
  await store.changePassword(identity.user.email, next);
  revokeSessionsFor(identity.user.sub);
  send(response, 200, { ok: true, reauthenticate: true });
}

// Supabase-compatible user endpoint. The invite flow (and an account created by
// an operator with must_change_password) sets its first password here; any
// later change must present the current password.
async function handleUserUpdate(request, response) {
  let identity;
  try {
    identity = requireIdentity(request);
  } catch (error) {
    send(response, 401, { error: error.code ?? "unauthenticated" });
    return;
  }
  const body = await readJson(request);
  const next = typeof body.password === "string" ? body.password : "";
  const current = typeof body.current_password === "string" ? body.current_password : "";
  if (!next) {
    send(response, 400, { error: "password_required" });
    return;
  }
  const policy = passwordPolicyError(next, identity.user.email);
  if (policy) {
    send(response, 400, { error: policy });
    return;
  }
  if (identity.user.mustChangePassword || !identity.user.passwordChangedAt) {
    await store.setInitialPassword(identity.user.email, next);
    send(response, 200, { ok: true, must_change_password: false });
    return;
  }
  if (!current) {
    send(response, 400, { error: "current_password_required" });
    return;
  }
  if (!(await verifyPassword(identity.user.passwordHash, current))) {
    send(response, 400, { error: "invalid_current_password" });
    return;
  }
  await store.changePassword(identity.user.email, next);
  revokeSessionsFor(identity.user.sub);
  send(response, 200, { ok: true, reauthenticate: true });
}

async function handle(request, response) {
  const url = new URL(request.url ?? "/", "http://demo-auth");
  await store.refreshIfChanged();

  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { ok: true, service: "tanaghom-auth", accounts: store.size });
    return;
  }
  if (request.method === "GET" && url.pathname === "/auth/v1/.well-known/jwks.json") {
    send(response, 200, jwks, { "Cache-Control": "public, max-age=300" });
    return;
  }
  if (url.pathname === "/auth/v1/token") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handleToken(request, response);
    return;
  }
  if (url.pathname === "/auth/v1/logout") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handleLogout(request, response);
    return;
  }
  if (url.pathname === "/auth/v1/password") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handlePassword(request, response);
    return;
  }
  if (url.pathname === "/auth/v1/user") {
    if (request.method === "GET") {
      let identity;
      try {
        identity = requireIdentity(request);
      } catch (error) {
        send(response, 401, { error: error.code ?? "unauthenticated" });
        return;
      }
      send(response, 200, {
        sub: identity.user.sub,
        email: identity.user.email,
        must_change_password: identity.user.mustChangePassword,
      });
      return;
    }
    if (request.method === "PUT") {
      await handleUserUpdate(request, response);
      return;
    }
    send(response, 405, { error: "method_not_allowed" }, { Allow: "GET, PUT" });
    return;
  }
  send(response, 404, { error: "not_found" });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const status = Number.isInteger(error?.status) ? error.status : 400;
    send(response, status, { error: status === 413 ? "body_too_large" : "invalid_request" });
  });
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.on("clientError", (_error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessions) {
    if (entry.absoluteExpiresAt <= now || now - entry.lastSeenAt > IDLE_TTL_MS) sessions.delete(key);
  }
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key);
  }
  if (sessions.size > 5000) {
    const excess = sessions.size - 5000;
    let removed = 0;
    for (const token of sessions.keys()) {
      sessions.delete(token);
      if (++removed >= excess) break;
    }
  }
}, 60 * 1000);
sweep.unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({
    service: "tanaghom-auth",
    status: "ready",
    accounts: store.size,
    access_ttl_seconds: ACCESS_TTL_SECONDS,
    idle_ttl_seconds: Math.round(IDLE_TTL_MS / 1000),
    absolute_ttl_seconds: Math.round(ABSOLUTE_TTL_MS / 1000),
  }));
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
