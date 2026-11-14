import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { createMailer } from "./mailer.mjs";
import { burnPasswordCheck, passwordPolicyError, verifyPassword } from "./passwords.mjs";
import { AuthTokenError, createUserStore, StoreError } from "./store.mjs";

const KEY_FILE = process.env.AUTH_PRIVATE_KEY_FILE ?? "/run/secrets/auth_private_key";
const PORT = Number(process.env.DEMO_AUTH_PORT ?? "43191");
const ISSUER = (process.env.DEMO_AUTH_ISSUER ?? "http://auth:43191/auth/v1").replace(/\/$/, "");
const STORE_FILE = process.env.AUTH_STORE_FILE ?? "/data/auth-users.json";
const SEED_FILE = process.env.AUTH_SEED_FILE ?? "/run/secrets/auth_users";
const INTERNAL_TOKEN_FILE = process.env.AUTH_INTERNAL_TOKEN_FILE ?? "/run/secrets/auth_internal_token";
const MAX_BODY_BYTES = 64 * 1024;

function positiveInt(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`invalid ${name}`);
  return value;
}

// Access tokens are short-lived; the opaque refresh token is the Postgres
// session row, so revocation is immediate and survives a restart.
const ACCESS_TTL_SECONDS = positiveInt("AUTH_ACCESS_TTL_SECONDS", 900);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LIMITS = {
  ip: positiveInt("AUTH_LOGIN_IP_LIMIT", 20),
  pair: positiveInt("AUTH_LOGIN_PAIR_LIMIT", 8),
};
const SIGNUP_LIMIT = positiveInt("AUTH_SIGNUP_IP_LIMIT", 5);
const MAX_FAILURE_KEYS = positiveInt("AUTH_RATE_LIMIT_MAX_KEYS", 10_000);
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const EMAIL_LIMITS = Object.freeze({
  forgotIp: positiveInt("AUTH_FORGOT_IP_LIMIT", 5),
  forgotPair: positiveInt("AUTH_FORGOT_PAIR_LIMIT", 3),
  verifyIp: positiveInt("AUTH_VERIFY_IP_LIMIT", 10),
  resetIp: positiveInt("AUTH_RESET_IP_LIMIT", 10),
  resendUser: positiveInt("AUTH_RESEND_USER_LIMIT", 3),
  resendIp: positiveInt("AUTH_RESEND_IP_LIMIT", 3),
});
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
    return value.trim();
  } catch {
    throw new Error(`required demo auth secret unavailable: ${path}`);
  }
}

const internalToken = readSecret(INTERNAL_TOKEN_FILE);
const authMailer = createMailer();
const store = createUserStore({ legacyFile: STORE_FILE, seedFile: SEED_FILE });
await store.load();
if ((await store.count()) < 1) throw new Error("auth store must contain at least one account");

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

// key -> { count, resetAt }
const failures = new Map();

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function compactJson(value) {
  return base64url(JSON.stringify(value));
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
    organization_id: user.organizationId,
    membership_role: user.role,
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

async function issueSession(user, userAgent) {
  if (!user.organizationId) {
    throw Object.assign(new Error("workspace_required"), { status: 403, code: "workspace_required" });
  }
  const session = await store.createSession({
    userId: user.sub,
    organizationId: user.organizationId,
    userAgent: userAgent ?? null,
  });
  return {
    access_token: mintAccessToken(user, session.id),
    token_type: "bearer",
    expires_in: ACCESS_TTL_SECONDS,
    expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS,
    refresh_token: session.token,
    must_change_password: user.mustChangePassword,
    organization: { id: user.organizationId, name: user.organizationName, role: user.role },
  };
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
  if (typeof claims.session_id !== "string" || !UUID_RE.test(claims.session_id)) return null;
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

// The map is bounded so spoofed keys cannot grow it without limit between
// sweeps. A full map first drops expired entries, then the oldest key.
function storeFailure(key, entry) {
  if (!failures.has(key) && failures.size >= MAX_FAILURE_KEYS) {
    const now = Date.now();
    for (const [candidate, value] of failures) {
      if (value.resetAt <= now) failures.delete(candidate);
    }
    while (failures.size >= MAX_FAILURE_KEYS) {
      const oldest = failures.keys().next().value;
      if (oldest === undefined) break;
      failures.delete(oldest);
    }
  }
  failures.set(key, entry);
}

function loginBlock(address, email) {
  // Email-only blocks are intentionally absent: an attacker on another IP
  // must not be able to lock the legitimate account owner out of sign-in.
  const pairs = [
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

function signupBlock(address) {
  const entry = currentFailure(`signup|${address}`);
  return entry && entry.count >= SIGNUP_LIMIT
    ? Math.ceil((entry.resetAt - Date.now()) / 1000)
    : 0;
}

function noteSignup(address) {
  const key = `signup|${address}`;
  const entry = currentFailure(key);
  if (!entry) storeFailure(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  else entry.count += 1;
}

function noteLoginFailure(address, email) {
  const now = Date.now();
  const keys = [`ip|${address}`, `pair|${address}|${email}`];
  for (const key of keys) {
    const entry = currentFailure(key);
    if (!entry) storeFailure(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    else entry.count += 1;
  }
}

function clearLoginFailures(address, email) {
  failures.delete(`pair|${address}|${email}`);
}

function rateLimitRetry(entries) {
  let retryAfter = 0;
  for (const [key, limit] of entries) {
    const entry = currentFailure(key);
    if (entry && entry.count >= limit) {
      retryAfter = Math.max(retryAfter, Math.ceil((entry.resetAt - Date.now()) / 1000));
    }
  }
  return retryAfter;
}

function noteRateLimit(key, windowMs) {
  const entry = currentFailure(key);
  if (!entry) storeFailure(key, { count: 1, resetAt: Date.now() + windowMs });
  else entry.count += 1;
}

function takeRateLimit(entries, windowMs) {
  const retryAfter = rateLimitRetry(entries);
  if (retryAfter > 0) return retryAfter;
  for (const [key] of entries) noteRateLimit(key, windowMs);
  return 0;
}

function rateLimited(response, retryAfter) {
  send(response, 429, { error: "too_many_attempts", retry_after: retryAfter }, { "Retry-After": String(retryAfter) });
}

function queuedDelivery() {
  return authMailer.configured ? "queued" : "skipped_unconfigured";
}

function logEmailIssue(purpose, userId) {
  console.error(JSON.stringify({ event: "auth_email_token_issue_failed", purpose, user_id: userId }));
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
    // Caddy replaces this header with the direct peer, and the auth service is
    // not publicly exposed. Taking the rightmost value also prevents a
    // client-supplied leftmost address from choosing its rate-limit bucket.
    const last = forwarded.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return request.socket.remoteAddress ?? "unknown";
}

function bearerToken(request) {
  const header = request.headers.authorization;
  const match = typeof header === "string" ? header.match(/^Bearer\s+(.+)$/i) : null;
  return match ? match[1] : null;
}

function requireInternal(request) {
  // The dashboard's server-side admin client authenticates with apikey/Bearer;
  // operator scripts may send the explicit header instead.
  const header = request.headers["x-auth-internal-token"]
    ?? request.headers.apikey
    ?? (typeof request.headers.authorization === "string"
      ? request.headers.authorization.replace(/^Bearer\s+/i, "")
      : "");
  const provided = Buffer.from(typeof header === "string" ? header : "", "utf8");
  const expected = Buffer.from(internalToken, "utf8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw Object.assign(new Error("forbidden"), { status: 403 });
  }
}

async function requireIdentity(request) {
  const token = bearerToken(request);
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) throw Object.assign(new Error("unauthenticated"), { status: 401, code: "session_expired" });
  const user = await store.findBySub(claims.sub);
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
    const user = await store.findByEmail(email);
    const passwordMatches = user && !user.disabled
      ? await verifyPassword(user.passwordHash, password)
      : await burnPasswordCheck(password);
    if (!user || user.disabled || !passwordMatches) {
      noteLoginFailure(address, email);
      send(response, 401, { error: "invalid_grant", error_description: "Invalid login credentials" });
      return;
    }
    clearLoginFailures(address, email);
    let session;
    try {
      session = await issueSession(user, request.headers["user-agent"]);
    } catch (error) {
      send(response, error.status ?? 400, { error: error.code ?? "login_failed" });
      return;
    }
    await store.touchLogin(user.sub);
    send(response, 200, session);
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    const session = refreshToken ? await store.findSession(refreshToken) : null;
    if (!session) {
      send(response, 401, { error: "invalid_grant", error_description: "Invalid refresh token" });
      return;
    }
    const user = await store.findBySub(session.user_id);
    if (!user || user.disabled || user.organizationId !== session.organization_id) {
      await store.revokeSessionByToken(refreshToken);
      send(response, 401, { error: "session_revoked", error_description: "Session revoked" });
      return;
    }
    const token = await store.rotateSession(session, { userAgent: request.headers["user-agent"] });
    send(response, 200, {
      access_token: mintAccessToken(user, session.id),
      token_type: "bearer",
      expires_in: ACCESS_TTL_SECONDS,
      expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS,
      refresh_token: token,
      must_change_password: user.mustChangePassword,
    });
    return;
  }

  if (grantType === "logout") {
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (refreshToken) await store.revokeSessionByToken(refreshToken);
    sendEmpty(response, 204);
    return;
  }

  send(response, 400, { error: "unsupported_grant_type" });
}

async function handleLogout(request, response) {
  const body = await readJson(request).catch(() => ({}));
  const token = typeof body.refresh_token === "string" ? body.refresh_token : request.headers["x-refresh-token"];
  if (typeof token === "string" && token) await store.revokeSessionByToken(token);
  sendEmpty(response, 204);
}

async function handlePassword(request, response) {
  let identity;
  try {
    identity = await requireIdentity(request);
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
  send(response, 200, { ok: true, reauthenticate: true });
}

// Supabase-compatible user endpoint. The invite flow (and an account created by
// an operator with must_change_password) sets its first password here; any
// later change must present the current password.
async function handleUserUpdate(request, response) {
  let identity;
  try {
    identity = await requireIdentity(request);
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
  send(response, 200, { ok: true, reauthenticate: true });
}

async function handleVerifyEmail(request, response) {
  const retryAfter = takeRateLimit(
    [[`verify|ip|${addressOf(request)}`, EMAIL_LIMITS.verifyIp]],
    FIFTEEN_MINUTES_MS,
  );
  if (retryAfter > 0) return rateLimited(response, retryAfter);
  const body = await readJson(request);
  const token = typeof body.token === "string" ? body.token : "";
  try {
    await store.consumeAuthToken({ token, purposes: ["verify_email"] });
    send(response, 200, { ok: true, email_verified: true });
  } catch (error) {
    if (error instanceof AuthTokenError || error instanceof StoreError) {
      send(response, 400, { error: error.message });
      return;
    }
    throw error;
  }
}

async function handleVerifyEmailResend(request, response) {
  let identity;
  try {
    identity = await requireIdentity(request);
  } catch (error) {
    send(response, 401, { error: error.code ?? "unauthenticated" });
    return;
  }
  if (identity.user.emailVerifiedAt) {
    send(response, 200, { ok: true, already_verified: true, emailDelivery: "not_required" });
    return;
  }
  const address = addressOf(request);
  const retryAfter = takeRateLimit(
    [
      [`resend|user|${identity.user.sub}`, EMAIL_LIMITS.resendUser],
      [`resend|ip|${address}`, EMAIL_LIMITS.resendIp],
    ],
    ONE_HOUR_MS,
  );
  if (retryAfter > 0) return rateLimited(response, retryAfter);
  let issued;
  try {
    issued = await store.issueAuthToken({
      userId: identity.user.sub,
      purpose: "verify_email",
    });
  } catch (error) {
    logEmailIssue("verify_email", identity.user.sub);
    send(response, 503, { error: "email_token_unavailable" });
    return;
  }
  const emailDelivery = await authMailer.sendVerifyEmail({ to: identity.user.email, token: issued.token });
  send(response, 200, { ok: true, emailDelivery });
}

async function handleForgotPassword(request, response) {
  const body = await readJson(request).catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 320) : "";
  const address = addressOf(request);
  const retryAfter = takeRateLimit(
    [
      [`forgot|ip|${address}`, EMAIL_LIMITS.forgotIp],
      [`forgot|pair|${address}|${email || "invalid"}`, EMAIL_LIMITS.forgotPair],
    ],
    FIFTEEN_MINUTES_MS,
  );
  if (retryAfter > 0) return rateLimited(response, retryAfter);

  // Anti-enumeration: lookup, token issuance, and delivery happen only for an
  // active account, but every path returns the same body. Delivery is queued so
  // a configured provider cannot make a known address measurably slower.
  const user = email ? await store.findByEmail(email) : null;
  if (user && !user.disabled) {
    try {
      const issued = await store.issueAuthToken({ userId: user.sub, purpose: "reset_password" });
      void authMailer.sendResetEmail({ to: user.email, token: issued.token }).catch(() => {});
    } catch {
      logEmailIssue("reset_password", user.sub);
    }
  }
  send(response, 200, { ok: true, emailDelivery: queuedDelivery() });
}

async function handleResetPassword(request, response) {
  const retryAfter = takeRateLimit(
    [[`reset|ip|${addressOf(request)}`, EMAIL_LIMITS.resetIp]],
    FIFTEEN_MINUTES_MS,
  );
  if (retryAfter > 0) return rateLimited(response, retryAfter);
  const body = await readJson(request);
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!token || !password) {
    send(response, 400, { error: "password_and_token_required" });
    return;
  }
  try {
    // Invite links are accepted here too, so the customer can use one clean
    // password screen whether the link was a reset or an invitation.
    await store.consumeAuthToken({ token, purposes: ["reset_password", "invite"], password });
    send(response, 200, { ok: true, reauthenticate: true });
  } catch (error) {
    if (error instanceof AuthTokenError || error instanceof StoreError) {
      send(response, 400, { error: error.message });
      return;
    }
    throw error;
  }
}

async function handleAcceptInvite(request, response) {
  const retryAfter = takeRateLimit(
    [[`invite|ip|${addressOf(request)}`, EMAIL_LIMITS.resetIp]],
    FIFTEEN_MINUTES_MS,
  );
  if (retryAfter > 0) return rateLimited(response, retryAfter);
  const body = await readJson(request);
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = body.display_name;
  if (!token || !password) {
    send(response, 400, { error: "password_and_token_required" });
    return;
  }
  try {
    const accepted = await store.consumeAuthToken({
      token,
      purposes: ["invite"],
      password,
      displayName,
    });
    send(response, 200, {
      ok: true,
      sub: accepted.sub,
      email: accepted.email,
      email_verified: true,
    });
  } catch (error) {
    if (error instanceof AuthTokenError || error instanceof StoreError) {
      send(response, 400, { error: error.message });
      return;
    }
    throw error;
  }
}

async function handleSignup(request, response) {
  const address = addressOf(request);
  const retryAfter = signupBlock(address);
  if (retryAfter > 0) {
    send(response, 429, { error: "too_many_attempts", retry_after: retryAfter }, { "Retry-After": String(retryAfter) });
    return;
  }
  noteSignup(address);
  const body = await readJson(request);
  try {
    const result = await store.signup({
      email: body.email,
      password: body.password,
      fullName: body.full_name,
      organizationName: body.organization_name,
      locale: body.locale,
      userAgent: request.headers["user-agent"],
    });
    let emailDelivery = queuedDelivery();
    try {
      const issued = await store.issueAuthToken({
        userId: result.user.sub,
        purpose: "verify_email",
      });
      void authMailer.sendVerifyEmail({ to: result.user.email, token: issued.token }).catch(() => {});
    } catch {
      emailDelivery = "failed";
      logEmailIssue("verify_email", result.user.sub);
    }
    send(response, 201, {
      access_token: mintAccessToken(result.user, result.session.id),
      token_type: "bearer",
      expires_in: ACCESS_TTL_SECONDS,
      expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS,
      refresh_token: result.session.token,
      must_change_password: false,
      emailDelivery,
      organization: {
        id: result.organizationId,
        name: result.organizationName,
        role: "owner",
      },
    });
  } catch (error) {
    if (error instanceof StoreError) {
      const status = error.message === "email_taken" ? 409 : 400;
      send(response, status, { error: error.message });
      return;
    }
    throw error;
  }
}

async function handleSessions(request, response) {
  let identity;
  try {
    identity = await requireIdentity(request);
  } catch (error) {
    send(response, 401, { error: error.code ?? "unauthenticated" });
    return;
  }
  const url = new URL(request.url ?? "/", "http://demo-auth");
  if (request.method === "GET") {
    const sessions = await store.listSessions(identity.user.sub, identity.claims.session_id);
    send(response, 200, { sessions });
    return;
  }
  if (request.method === "DELETE") {
    const id = url.searchParams.get("id") ?? "";
    if (!UUID_RE.test(id)) {
      send(response, 400, { error: "invalid_session" });
      return;
    }
    const revoked = await store.revokeSession(id, identity.user.sub);
    if (!revoked) {
      send(response, 404, { error: "session_not_found" });
      return;
    }
    send(response, 200, { ok: true, reauthenticate: id === identity.claims.session_id });
    return;
  }
  send(response, 405, { error: "method_not_allowed" }, { Allow: "GET, DELETE" });
}

async function handleInvite(request, response) {
  requireInternal(request);
  const body = await readJson(request);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email.includes("@")) {
    send(response, 400, { error: "invalid_email" });
    return;
  }
  const password = randomBytes(24).toString("base64url");
  let user;
  try {
    user = await store.createInvitedUser({
      email,
      displayName: typeof body.display_name === "string" ? body.display_name : null,
      password,
    });
  } catch (error) {
    if (error instanceof StoreError && error.code === "email_taken") {
      send(response, 409, { error: "email_already_added" });
      return;
    }
    throw error;
  }
  let emailDelivery = "failed";
  try {
    const issued = await store.issueAuthToken({ userId: user.sub, purpose: "invite" });
    emailDelivery = await authMailer.sendInviteEmail({ to: user.email, token: issued.token });
  } catch {
    logEmailIssue("invite", user.sub);
  }
  send(response, 201, {
    id: user.sub,
    email: user.email,
    email_delivery: emailDelivery,
    emailDelivery,
  });
}

async function handleAdminDelete(request, response, userId) {
  requireInternal(request);
  if (!UUID_RE.test(userId)) {
    send(response, 400, { error: "invalid_user" });
    return;
  }
  await store.deleteUser(userId);
  sendEmpty(response, 204);
}

async function handle(request, response) {
  const url = new URL(request.url ?? "/", "http://demo-auth");

  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { ok: true, service: "tanaghom-auth", accounts: await store.count() });
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
  if (url.pathname === "/auth/v1/signup") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handleSignup(request, response);
    return;
  }
  if (url.pathname === "/auth/v1/verify-email") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handleVerifyEmail(request, response);
    return;
  }
  if (url.pathname === "/auth/v1/verify-email/resend") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handleVerifyEmailResend(request, response);
    return;
  }
  if (url.pathname === "/auth/v1/forgot-password") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handleForgotPassword(request, response);
    return;
  }
  if (url.pathname === "/auth/v1/reset-password") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handleResetPassword(request, response);
    return;
  }
  if (url.pathname === "/auth/v1/accept-invite") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handleAcceptInvite(request, response);
    return;
  }
  if (url.pathname === "/auth/v1/sessions") {
    await handleSessions(request, response);
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
  if (url.pathname === "/auth/v1/invite") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return;
    }
    await handleInvite(request, response);
    return;
  }
  const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/i);
  if (adminUser) {
    if (request.method !== "DELETE") {
      send(response, 405, { error: "method_not_allowed" }, { Allow: "DELETE" });
      return;
    }
    await handleAdminDelete(request, response, adminUser[1]);
    return;
  }
  if (url.pathname === "/auth/v1/user") {
    if (request.method === "GET") {
      let identity;
      try {
        identity = await requireIdentity(request);
      } catch (error) {
        send(response, 401, { error: error.code ?? "unauthenticated" });
        return;
      }
      send(response, 200, {
        sub: identity.user.sub,
        email: identity.user.email,
        organization_id: identity.user.organizationId,
        role: identity.user.role,
        must_change_password: identity.user.mustChangePassword,
        email_verified: Boolean(identity.user.emailVerifiedAt),
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
    if (status >= 500) console.error("tanaghom-auth request failed", error);
    send(response, status, { error: status === 413 ? "body_too_large" : status === 403 ? "forbidden" : "invalid_request" });
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
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key);
  }
}, 60 * 1000);
sweep.unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({
    service: "tanaghom-auth",
    status: "ready",
    accounts: "postgres",
    access_ttl_seconds: ACCESS_TTL_SECONDS,
  }));
});

function shutdown() {
  server.close(async () => {
    await store.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
