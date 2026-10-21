import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const USERS_FILE = "/run/secrets/auth_users";
const KEY_FILE = "/run/secrets/auth_private_key";
const PORT = Number(process.env.DEMO_AUTH_PORT ?? "43191");
const ISSUER = (process.env.DEMO_AUTH_ISSUER ?? "http://auth:43191/auth/v1").replace(/\/$/, "");
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
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

const usersFile = JSON.parse(readSecret(USERS_FILE));
if (!usersFile || !Array.isArray(usersFile.users) || usersFile.users.length < 1) {
  throw new Error("demo auth users file must contain a users array");
}

const users = new Map();
const usersBySubject = new Map();
for (const item of usersFile.users) {
  if (!item || typeof item.email !== "string" || typeof item.password !== "string" || typeof item.sub !== "string") {
    throw new Error("invalid demo auth user entry");
  }
  const email = item.email.trim().toLowerCase();
  if (!email.includes("@") || email.length > 320 || item.password.length < 16 || item.password.length > 512 || !UUID_RE.test(item.sub)) {
    throw new Error("invalid demo auth user value");
  }
  if (users.has(email) || usersBySubject.has(item.sub)) throw new Error("duplicate demo auth user");
  const passwordHash = createHash("sha256").update(item.password, "utf8").digest();
  users.set(email, { email, passwordHash, sub: item.sub });
  usersBySubject.set(item.sub, { email, sub: item.sub });
}

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

const refreshTokens = new Map();
const loginFailures = new Map();

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
    session_id: sessionId,
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
  refreshTokens.set(refreshToken, {
    sub: user.sub,
    sessionId,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  });
  return {
    access_token: mintAccessToken(user, sessionId),
    token_type: "bearer",
    expires_in: ACCESS_TTL_SECONDS,
    expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
  };
}

function passwordMatches(user, password) {
  const supplied = createHash("sha256").update(password, "utf8").digest();
  return timingSafeEqual(user.passwordHash, supplied);
}

function loginFailureKey(address, email) {
  return `${address}|${email}`;
}

function blocked(address, email) {
  const entry = loginFailures.get(loginFailureKey(address, email));
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= 8);
}

function noteFailure(address, email) {
  const key = loginFailureKey(address, email);
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= now) {
    loginFailures.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

function clearFailures(address, email) {
  loginFailures.delete(loginFailureKey(address, email));
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
  return request.socket.remoteAddress ?? "unknown";
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
    if (blocked(address, email)) {
      send(response, 429, { error: "too_many_attempts" });
      return;
    }
    const user = users.get(email);
    if (!user || !passwordMatches(user, password)) {
      noteFailure(address, email);
      send(response, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
      return;
    }
    clearFailures(address, email);
    send(response, 200, issueSession(user));
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    const entry = refreshToken && refreshTokens.get(refreshToken);
    if (!entry || entry.expiresAt <= Date.now()) {
      if (refreshToken) refreshTokens.delete(refreshToken);
      send(response, 400, { error: "invalid_grant", error_description: "Invalid refresh token" });
      return;
    }
    const user = usersBySubject.get(entry.sub);
    if (!user) {
      refreshTokens.delete(refreshToken);
      send(response, 400, { error: "invalid_grant", error_description: "Invalid refresh token" });
      return;
    }
    refreshTokens.delete(refreshToken);
    const session = issueSession(user);
    send(response, 200, session);
    return;
  }

  send(response, 400, { error: "unsupported_grant_type" });
}

async function handle(request, response) {
  const url = new URL(request.url ?? "/", "http://demo-auth");
  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { ok: true, service: "tanaghom-demo-auth" });
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
  for (const [token, entry] of refreshTokens) {
    if (entry.expiresAt <= now) refreshTokens.delete(token);
  }
  for (const [key, entry] of loginFailures) {
    if (entry.resetAt <= now) loginFailures.delete(key);
  }
  if (refreshTokens.size > 5000) {
    const excess = refreshTokens.size - 5000;
    let removed = 0;
    for (const token of refreshTokens.keys()) {
      refreshTokens.delete(token);
      if (++removed >= excess) break;
    }
  }
}, 10 * 60 * 1000);
sweep.unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ service: "tanaghom-demo-auth", status: "ready", users: users.size }));
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
