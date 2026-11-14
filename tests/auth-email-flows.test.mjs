import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMailer, renderAuthEmail } from "../deployment/dashboard-demo/auth/mailer.mjs";
import { resetPasswordPolicyError } from "../deployment/dashboard-demo/auth/passwords.mjs";
import { hashAuthToken } from "../deployment/dashboard-demo/auth/store.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const token = "A".repeat(43);

test("auth tokens are random 32-byte values stored as SHA-256 hex", async () => {
  const store = await read("deployment/dashboard-demo/auth/store.mjs");
  assert.match(store, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(store, /digest\("hex"\)/);
  assert.match(store, /AUTH_TOKEN_TTL_MS/);
  assert.match(store, /verify_email: 24 \* 60 \* 60 \* 1000/);
  assert.match(store, /reset_password: 60 \* 60 \* 1000/);
  assert.match(store, /invite: 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(store, /FOR UPDATE/);
  assert.match(store, /used_at IS NULL/);
  assert.match(store, /UPDATE tanaghom\.sessions SET expires_at = now\(\)/);
  assert.match(store, /auth\.email_verified/);
  assert.match(store, /auth\.password_reset/);
  assert.equal(hashAuthToken(token).length, 64);
  assert.match(hashAuthToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashAuthToken(token), token);
});

test("reset passwords require ten characters with upper, lower, and a digit", () => {
  assert.equal(resetPasswordPolicyError("Short1A", "owner@example.test"), "password_too_short");
  assert.equal(resetPasswordPolicyError("alllowercase1", "owner@example.test"), "password_too_simple");
  assert.equal(resetPasswordPolicyError("ALLUPPERCASE1", "owner@example.test"), "password_too_simple");
  assert.equal(resetPasswordPolicyError("NoDigitsHere", "owner@example.test"), "password_too_simple");
  assert.equal(resetPasswordPolicyError("Good-pass1", "owner@example.test"), null);
  assert.equal(resetPasswordPolicyError("Ownername-pass1", "owner@example.test"), "password_contains_email");
});

test("disabled email mode is fail-open and never logs the token or full link", async () => {
  const logged = [];
  const mailer = createMailer({
    env: { APP_BASE_URL: "https://app.example.test" },
    logger: { log: (line) => logged.push(line), error: (line) => logged.push(line) },
  });
  assert.equal(mailer.mode, "disabled");
  assert.equal(await mailer.sendVerifyEmail({ to: "owner@example.test", token }), "skipped_unconfigured");
  assert.equal(logged.length, 1);
  const event = JSON.parse(logged[0]);
  assert.deepEqual(event, {
    event: "auth_email_skipped",
    purpose: "verify_email",
    to: "owner@example.test",
    reason: "provider_not_configured",
  });
  assert.ok(!logged[0].includes(token));
  assert.ok(!logged[0].includes("https://app.example.test"));
});

test("verification, reset, and invitation templates carry bilingual copy and single-use URLs", () => {
  for (const purpose of ["verify_email", "reset_password", "invite"]) {
    const rendered = renderAuthEmail({
      purpose,
      token,
      env: { APP_BASE_URL: "https://app.example.test" },
    });
    assert.ok(rendered.subject.includes("Tanaghom") || rendered.subject.includes("تناغم"));
    assert.ok(rendered.html.includes("lang=\"ar\"") && rendered.html.includes("dir=\"rtl\""));
    assert.ok(rendered.text.includes("Tanaghom"));
    assert.ok(rendered.text.includes(token));
    assert.ok(rendered.url.startsWith("https://app.example.test/"));
    assert.ok(rendered.html.includes(rendered.url));
  }
  assert.match(renderAuthEmail({ purpose: "verify_email", token }).url, /\/verify-email\?token=/);
  assert.match(renderAuthEmail({ purpose: "reset_password", token }).url, /\/reset-password\?token=/);
  assert.match(renderAuthEmail({ purpose: "invite", token }).url, /\/accept-invite\?token=/);
});

test("resend mode posts to Resend with an eight-second abort and configured sender", async () => {
  const calls = [];
  const mailer = createMailer({
    env: {
      AUTH_EMAIL_PROVIDER: "resend",
      AUTH_EMAIL_API_KEY: "re_test_key",
      AUTH_EMAIL_FROM: "Tanaghom <noreply@example.test>",
      APP_BASE_URL: "https://app.example.test",
    },
    logger: { log() {}, error() {} },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(mailer.mode, "resend");
  assert.equal(await mailer.sendResetEmail({ to: "owner@example.test", token }), "sent");
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.Authorization, "Bearer re_test_key");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.from, "Tanaghom <noreply@example.test>");
  assert.deepEqual(body.to, ["owner@example.test"]);
  assert.match(body.text, /reset-password\?token=/);
  assert.ok(calls[0].init.signal);
});

test("public auth pages, proxies, and public-route allowances are wired", async () => {
  const proxy = await read("apps/dashboard/proxy.ts");
  const frame = await read("apps/dashboard/components/root-frame.tsx");
  for (const path of ["/forgot-password", "/reset-password", "/verify-email"]) {
    assert.ok(proxy.includes(`"${path}"`), `${path} must be public in proxy.ts`);
    assert.ok(frame.includes(`"${path}"`), `${path} must bypass the app shell`);
  }
  for (const route of [
    "app/api/auth/verify-email/route.ts",
    "app/api/auth/verify-email/resend/route.ts",
    "app/api/auth/forgot-password/route.ts",
    "app/api/auth/reset-password/route.ts",
  ]) {
    const source = await read(`apps/dashboard/${route}`);
    assert.match(source, /hasValidSameOrigin|authorization/);
    assert.match(source, /noStore/);
    assert.match(source, /postAuthEmail|authUpstreamPayload/);
  }
  const loginForm = await read("apps/dashboard/components/login-form.tsx");
  assert.match(loginForm, /Forgot password\?|forgot-password/);
  const mailer = await read("deployment/dashboard-demo/auth/mailer.mjs");
  assert.match(mailer, /AUTH_EMAIL_PROVIDER/);
  assert.match(mailer, /AUTH_EMAIL_API_KEY_FILE/);
  assert.match(mailer, /AUTH_EMAIL_FROM/);
  assert.match(mailer, /AbortSignal\.timeout\(SEND_TIMEOUT_MS\)/);
  assert.doesNotMatch(mailer, /console\.log\([^)]*token/i);
});

test("invitations are non-destructive and auth can reach the email provider", async () => {
  const compose = await read("deployment/dashboard-demo/compose.yml");
  const authSection = compose.slice(compose.indexOf("\n  auth:"), compose.indexOf("\n  storage:"));
  assert.ok(authSection.includes("networks: [backend, edge]"), "auth needs outbound HTTPS egress");
  assert.ok(!/\n    ports:/.test(authSection), "auth must stay off host ports");
  assert.ok(authSection.includes("APP_BASE_URL: ${TANAGHOM_DEMO_BASE_URL:-http://127.0.0.1:3210}"));
  assert.ok(authSection.includes("auth_email_api_key"), "the optional key file must be mounted");

  const store = await read("deployment/dashboard-demo/auth/store.mjs");
  assert.match(store, /async createInvitedUser/);
  assert.match(store, /ON CONFLICT \(email\) DO NOTHING/);
  const server = await read("deployment/dashboard-demo/auth/server.mjs");
  const invite = server.slice(server.indexOf("async function handleInvite"), server.indexOf("async function handleAdminDelete"));
  assert.match(invite, /createInvitedUser/);
  assert.doesNotMatch(invite, /store\.upsert/);
  assert.match(invite, /body\.data/);
  assert.match(invite, /email_already_added/);

  const team = await read("apps/dashboard/lib/server/team-management.ts");
  assert.match(team, /SELECT 1 FROM tanaghom\.app_users WHERE lower\(email\) = \$1/);
  assert.doesNotMatch(team, /organization_id = \$1 AND lower\(email\) = \$2/);
  const admin = await read("apps/dashboard/lib/server/supabase-admin.ts");
  assert.match(admin, /email_already_added/);

  const validator = await read("deployment/dashboard-demo/scripts/validate-compose.py");
  assert.match(validator, /auth and dashboard APP_BASE_URL must match/);
  assert.match(validator, /auth needs the non-internal edge network/);
});
