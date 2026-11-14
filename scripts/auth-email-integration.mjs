import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import { createUserStore, hashAuthToken } from "../deployment/dashboard-demo/auth/store.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for auth email integration tests.");
  process.exit(2);
}

const root = fileURLToPath(new URL("../", import.meta.url));
const authDir = join(root, "deployment", "dashboard-demo", "auth");
const temp = await mkdtemp(join(tmpdir(), "tanaghom-auth-email-"));
const keyFile = join(temp, "auth-private-key.pem");
const internalFile = join(temp, "auth-internal-token");
const port = 45000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const internalToken = randomBytes(32).toString("hex");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
await writeFile(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
await writeFile(internalFile, `${internalToken}\n`);

const store = createUserStore({ legacyFile: join(temp, "missing-legacy.json"), seedFile: join(temp, "missing-seed.json") });
await store.load();
const bootstrap = await store.signup({
  email: `bootstrap-${Date.now()}@example.test`,
  password: "Bootstrap-horse-battery-9",
  fullName: "Bootstrap Owner",
  organizationName: "Bootstrap Workspace",
});
assert.ok(bootstrap.user.sub);

const child = spawn(process.execPath, [join(authDir, "server.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    AUTH_PRIVATE_KEY_FILE: keyFile,
    AUTH_INTERNAL_TOKEN_FILE: internalFile,
    AUTH_STORE_FILE: join(temp, "missing-legacy.json"),
    AUTH_SEED_FILE: join(temp, "missing-seed.json"),
    DEMO_AUTH_PORT: String(port),
    DEMO_AUTH_ISSUER: `${base}/auth/v1`,
    APP_BASE_URL: "https://app.example.test",
    AUTH_EMAIL_PROVIDER: "disabled",
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
child.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
let exited = false;
child.once("exit", () => { exited = true; });

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (exited) throw new Error(`auth service exited before health\n${serverLog}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // Keep polling while the listener starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`auth service did not become healthy\n${serverLog}`);
}

async function api(path, body, { address = "127.0.0.1", bearer = "", headers = {} } = {}) {
  const response = await fetch(`${base}/auth/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": address,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { status: response.status, body: parsed, headers: response.headers };
}

async function signup(email, address) {
  const result = await api("/signup", {
    email,
    password: "Correct-horse-battery-staple-9",
    full_name: "Integration Owner",
    organization_name: `Workspace ${randomBytes(3).toString("hex")}`,
    locale: "en",
  }, { address });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.emailDelivery, "skipped_unconfigured");
  return result.body;
}

async function userId(email) {
  const result = await pool.query("SELECT id FROM tanaghom.users WHERE email = $1", [email]);
  assert.ok(result.rows[0], `user ${email} must exist`);
  return result.rows[0].id;
}

try {
  await waitForHealth();
  const verifyEmail = `verify-${Date.now()}@example.test`;
  await signup(verifyEmail, "198.51.100.10");
  const verifyId = await userId(verifyEmail);

  const staleVerify = await store.issueAuthToken({ userId: verifyId, purpose: "verify_email" });
  const firstVerify = await store.issueAuthToken({ userId: verifyId, purpose: "verify_email" });
  const stale = await api("/verify-email", { token: staleVerify.token }, { address: "198.51.100.10" });
  assert.equal(stale.status, 400, "a fresh issuance must invalidate the prior verification token");
  const verified = await api("/verify-email", { token: firstVerify.token }, { address: "198.51.100.10" });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.email_verified, true);
  const verifiedRow = await pool.query("SELECT email_verified_at FROM tanaghom.users WHERE id = $1", [verifyId]);
  assert.ok(verifiedRow.rows[0].email_verified_at);

  const replay = await api("/verify-email", { token: firstVerify.token }, { address: "198.51.100.10" });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, "invalid_or_expired_token");

  const expiredVerify = await store.issueAuthToken({ userId: verifyId, purpose: "verify_email" });
  await pool.query("UPDATE tanaghom.auth_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1", [hashAuthToken(expiredVerify.token)]);
  const expired = await api("/verify-email", { token: expiredVerify.token }, { address: "198.51.100.10" });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error, "invalid_or_expired_token");

  const resetEmail = `reset-${Date.now()}@example.test`;
  const resetSession = await signup(resetEmail, "198.51.100.11");
  const resetId = await userId(resetEmail);

  const unknownForgot = await api("/forgot-password", { email: `unknown-${Date.now()}@example.test` }, { address: "198.51.100.20" });
  const knownForgot = await api("/forgot-password", { email: resetEmail }, { address: "198.51.100.21" });
  assert.equal(unknownForgot.status, 200);
  assert.equal(knownForgot.status, 200);
  assert.deepEqual(unknownForgot.body, knownForgot.body);
  const issuedReset = await pool.query(
    "SELECT count(*)::int AS count FROM tanaghom.auth_tokens WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL",
    [resetId],
  );
  assert.ok(issuedReset.rows[0].count >= 1);

  const resetToken = await store.issueAuthToken({ userId: resetId, purpose: "reset_password" });
  const reset = await api("/reset-password", { token: resetToken.token, password: "New-horse-battery-staple-9" }, { address: "198.51.100.30" });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.reauthenticate, true);

  const oldLogin = await api("/token?grant_type=password", { email: resetEmail, password: "Correct-horse-battery-staple-9" }, { address: "198.51.100.30" });
  assert.equal(oldLogin.status, 401);
  const newLogin = await api("/token?grant_type=password", { email: resetEmail, password: "New-horse-battery-staple-9" }, { address: "198.51.100.30" });
  assert.equal(newLogin.status, 200, JSON.stringify(newLogin.body));
  const oldRefresh = await api("/token?grant_type=refresh_token", { refresh_token: resetSession.refresh_token }, { address: "198.51.100.30" });
  assert.equal(oldRefresh.status, 401);
  const resetSessions = await pool.query(
    "SELECT count(*)::int AS count FROM tanaghom.sessions WHERE user_id = $1 AND expires_at > now()",
    [resetId],
  );
  assert.equal(resetSessions.rows[0].count, 1, "only the fresh sign-in session stays active");
  const audit = await pool.query(
    "SELECT 1 FROM tanaghom.agent_actions_log WHERE action_type = 'auth.password_reset' AND entity_id = (SELECT id FROM tanaghom.app_users WHERE auth_subject = $1::uuid LIMIT 1)",
    [resetId],
  );
  assert.ok(audit.rows[0], "password reset must write an audit event");

  const resendEmail = `resend-${Date.now()}@example.test`;
  const resendSession = await signup(resendEmail, "198.51.100.12");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const resend = await api("/verify-email/resend", {}, { address: "198.51.100.40", bearer: resendSession.access_token });
    assert.equal(resend.status, 200, `resend attempt ${attempt + 1}: ${JSON.stringify(resend.body)}`);
  }
  const resendLimited = await api("/verify-email/resend", {}, { address: "198.51.100.40", bearer: resendSession.access_token });
  assert.equal(resendLimited.status, 429);

  const forgotAddress = "198.51.100.50";
  const rateEmail = `rate-${Date.now()}@example.test`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await api("/forgot-password", { email: rateEmail }, { address: forgotAddress });
    assert.equal(result.status, 200);
  }
  const forgotLimited = await api("/forgot-password", { email: rateEmail }, { address: forgotAddress });
  assert.equal(forgotLimited.status, 429);
  assert.ok(Number(forgotLimited.headers.get("retry-after")) > 0);

  const resetAddress = "198.51.100.60";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await api("/reset-password", { token: "invalid-token-that-is-long-enough", password: "Another-horse-battery-staple-9" }, { address: resetAddress });
    assert.equal(result.status, 400);
  }
  const resetLimited = await api("/reset-password", { token: "invalid-token-that-is-long-enough", password: "Another-horse-battery-staple-9" }, { address: resetAddress });
  assert.equal(resetLimited.status, 429);

  const tenantAEmail = `tenanta-${Date.now()}@example.test`;
  const tenantA = await signup(tenantAEmail, "198.51.100.71");
  const tenantAId = await userId(tenantAEmail);
  const beforeInvite = await pool.query(
    "SELECT password_hash, session_epoch, full_name FROM tanaghom.users WHERE id = $1",
    [tenantAId],
  );
  const beforeSessions = await pool.query(
    "SELECT count(*)::int AS count FROM tanaghom.sessions WHERE user_id = $1 AND expires_at > now()",
    [tenantAId],
  );
  const beforeTokens = await pool.query(
    "SELECT count(*)::int AS count FROM tanaghom.auth_tokens WHERE user_id = $1 AND purpose = 'invite'",
    [tenantAId],
  );
  const duplicateInvite = await api("/invite", {
    email: tenantAEmail,
    data: { display_name: "Hijacked Name", application: "tanaghom" },
  }, {
    address: "198.51.100.75",
    headers: { "x-auth-internal-token": internalToken },
  });
  assert.equal(duplicateInvite.status, 409, JSON.stringify(duplicateInvite.body));
  assert.deepEqual(duplicateInvite.body, { error: "email_already_added" });
  const afterInvite = await pool.query(
    "SELECT password_hash, session_epoch, full_name FROM tanaghom.users WHERE id = $1",
    [tenantAId],
  );
  const afterSessions = await pool.query(
    "SELECT count(*)::int AS count FROM tanaghom.sessions WHERE user_id = $1 AND expires_at > now()",
    [tenantAId],
  );
  const afterTokens = await pool.query(
    "SELECT count(*)::int AS count FROM tanaghom.auth_tokens WHERE user_id = $1 AND purpose = 'invite'",
    [tenantAId],
  );
  assert.deepEqual(afterInvite.rows[0], beforeInvite.rows[0], "an invitation must not rotate an existing password, epoch, or name");
  assert.equal(afterSessions.rows[0].count, beforeSessions.rows[0].count, "an invitation must not revoke existing sessions");
  assert.equal(afterTokens.rows[0].count, beforeTokens.rows[0].count, "an invitation must not issue a token for an existing user");

  const stillAuthenticated = await fetch(`${base}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${tenantA.access_token}` },
  });
  assert.equal(stillAuthenticated.status, 200, "an invitation must not invalidate the existing access token");
  const refreshed = await api("/token?grant_type=refresh_token", {
    refresh_token: tenantA.refresh_token,
  }, { address: "198.51.100.76" });
  assert.equal(refreshed.status, 200, "an invitation must not disrupt the existing refresh token");
  assert.notEqual(refreshed.body.refresh_token, tenantA.refresh_token, "refresh must still rotate cleanly");

  const inviteEmail = `invite-${Date.now()}@example.test`;
  const invited = await api("/invite", {
    email: inviteEmail,
    data: { display_name: "Invited Person", application: "tanaghom" },
  }, {
    address: "198.51.100.80",
    headers: { "x-auth-internal-token": internalToken },
  });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  assert.equal(invited.body.emailDelivery, "skipped_unconfigured");
  const invitedRow = await pool.query("SELECT full_name FROM tanaghom.users WHERE id = $1", [invited.body.id]);
  assert.equal(invitedRow.rows[0].full_name, "Invited Person");
  const inviteToken = await store.issueAuthToken({ userId: invited.body.id, purpose: "invite" });
  const accepted = await api("/accept-invite", {
    token: inviteToken.token,
    password: "Accepted-horse-battery-9",
    display_name: "Accepted Person",
  }, { address: "198.51.100.70" });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const acceptedRow = await pool.query("SELECT email_verified_at, full_name FROM tanaghom.users WHERE id = $1", [invited.body.id]);
  assert.ok(acceptedRow.rows[0].email_verified_at);
  assert.equal(acceptedRow.rows[0].full_name, "Accepted Person");

  assert.ok(serverLog.includes('"event":"auth_email_skipped"'));
  assert.ok(!serverLog.includes("Correct-horse-battery-staple-9"));
  assert.ok(!serverLog.includes("https://app.example.test"));
  console.log("AUTH_EMAIL_INTEGRATION_OK");
} catch (error) {
  console.error(serverLog);
  throw error;
} finally {
  if (!exited) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  await store.close().catch(() => {});
  await pool.end().catch(() => {});
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
