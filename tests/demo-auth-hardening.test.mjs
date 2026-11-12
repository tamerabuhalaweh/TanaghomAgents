import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  hashPassword,
  passwordPolicyError,
  verifyPassword,
} from "../deployment/dashboard-demo/auth/passwords.mjs";

const root = new URL("../", import.meta.url);
const authDir = new URL("deployment/dashboard-demo/auth/", root);
const composePath = new URL("deployment/dashboard-demo/compose.yml", root);
const caddyfilePath = new URL("deployment/dashboard-demo/caddy/Caddyfile", root);
const caddyEntrypoint = new URL("deployment/dashboard-demo/caddy/entrypoint.sh", root);
const onboardingScript = new URL("deployment/dashboard-demo/scripts/onboard-organization.sh", root);
const migrationPath = new URL("packages/database/migrations/0049_tenant_auth.up.sql", root);

test("passwords are scrypt-hashed, verified in constant time, and policy-checked", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert.match(hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!hash.includes("correct-horse-battery-staple"));
  assert.equal(await verifyPassword(hash, "correct-horse-battery-staple"), true);
  assert.equal(await verifyPassword(hash, "correct-horse-battery-stapl"), false);
  assert.equal(await verifyPassword("not-a-hash", "correct-horse-battery-staple"), false);

  assert.equal(passwordPolicyError("short", "owner@example.test"), "password_too_short");
  assert.equal(passwordPolicyError("tanaghom-password", "owner@example.test"), "password_too_common");
  assert.equal(passwordPolicyError("owner-name-is-long", "owner@example.test"), "password_contains_email");
  assert.equal(passwordPolicyError("correct-horse-battery-staple", "owner@example.test"), null);
});

test("auth accounts and sessions live in PostgreSQL, not the JSON store", async () => {
  const server = await readFile(new URL("server.mjs", authDir), "utf8");
  const store = await readFile(new URL("store.mjs", authDir), "utf8");
  const admin = await readFile(new URL("admin.mjs", authDir), "utf8");

  for (const table of ["tanaghom.users", "tanaghom.memberships", "tanaghom.sessions", "tanaghom.organizations"]) {
    assert.ok(store.includes(table), `store must use ${table}`);
  }
  assert.match(store, /import \{ Pool \} from "pg"/);
  assert.match(store, /token_hash/);
  assert.doesNotMatch(store, /writeFileSync|renameSync|fsyncSync/, "the JSON store must not be written anymore");
  assert.match(store, /importLegacyIfEmpty/);

  assert.match(server, /\/auth\/v1\/signup/);
  assert.match(server, /\/auth\/v1\/sessions/);
  assert.match(server, /x-auth-internal-token/);
  assert.match(server, /changePassword/);
  assert.doesNotMatch(server, /sessions\.set\(/, "sessions must not live in process memory");
  assert.match(admin, /await store\.list\(\)/);
});

test("the tenant auth migration creates the WS2 tables, constraints, and grants", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const table of ["users", "memberships", "auth_tokens", "sessions"]) {
    assert.match(sql, new RegExp(`CREATE TABLE tanaghom\\.${table}`));
  }
  assert.match(sql, /status text NOT NULL DEFAULT 'trialing'/);
  assert.match(sql, /stripe_customer_id text UNIQUE/);
  assert.match(sql, /default_locale text NOT NULL DEFAULT 'en'/);
  assert.match(sql, /PRIMARY KEY \(user_id, organization_id\)/);
  assert.match(sql, /purpose text NOT NULL CHECK \(purpose IN \('verify_email', 'reset_password', 'invite'\)\)/);
  assert.match(sql, /token_hash text NOT NULL UNIQUE/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON tanaghom\.users TO tanaghom_api/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON tanaghom\.sessions TO tanaghom_api/);
  assert.match(sql, /0049_tenant_auth/);
});

test("the public edge and onboarding guardrails are declared in source", async () => {
  const compose = await readFile(composePath, "utf8");
  assert.match(compose, /profiles: \[https\]/);
  assert.match(compose, /caddy:2\.10\.2-alpine@sha256:[0-9a-f]{64}/);
  assert.match(compose, /"80:80"/);
  assert.match(compose, /"443:443"/);
  assert.match(compose, /127\.0\.0\.1:3210:3000/);
  assert.match(compose, /AUTH_DATABASE_URL_FILE: \/run\/secrets\/database_url/);
  assert.match(compose, /AUTH_INTERNAL_TOKEN_FILE: \/run\/secrets\/auth_internal_token/);
  assert.match(compose, /AUTH_STORE_FILE: \/data\/auth-users\.json/);
  assert.match(compose, /AUTH_ACCESS_TTL_SECONDS/);

  const caddyfile = await readFile(caddyfilePath, "utf8");
  assert.match(caddyfile, /\{\$TANAGHOM_PUBLIC_DOMAIN\}/);
  assert.match(caddyfile, /reverse_proxy dashboard:3000/);
  assert.match(caddyfile, /reverse_proxy postiz:5000/);
  assert.match(caddyfile, /Strict-Transport-Security/);

  const onboarding = await readFile(onboardingScript, "utf8");
  assert.match(onboarding, /create_brand_kit/);
  assert.match(onboarding, /ONBOARD_BRAND_VOICE_AR/);
  assert.match(onboarding, /Demo Summer Camp/);
  assert.match(onboarding, /DEMO_CREDENTIALS_RETIRED/);
  assert.match(onboarding, /INSERT INTO tanaghom\.memberships/);
  // app_users_invitation_lifecycle requires auth_subject, invited_at and
  // accepted_at to be null together, so retirement must detach all three.
  assert.match(onboarding, /auth_subject = NULL, invited_at = NULL, accepted_at = NULL/);
  assert.match(onboarding, /UPDATE tanaghom\.users\s+SET disabled = true/);

  if (process.platform !== "win32") {
    const syntax = spawnSync("bash", ["-n", fileURLToPath(onboardingScript)], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
    const refused = spawnSync("sh", [fileURLToPath(caddyEntrypoint)], {
      env: { ...process.env, TANAGHOM_PUBLIC_DOMAIN: "localhost", TANAGHOM_POSTIZ_DOMAIN: "localhost" },
      encoding: "utf8",
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refusing to start Caddy/);
  }
});
