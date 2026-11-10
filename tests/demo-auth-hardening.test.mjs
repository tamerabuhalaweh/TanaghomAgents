import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const authDir = fileURLToPath(new URL("../deployment/dashboard-demo/auth/", import.meta.url));
const composePath = fileURLToPath(new URL("../deployment/dashboard-demo/compose.yml", import.meta.url));
const caddyfilePath = fileURLToPath(new URL("../deployment/dashboard-demo/caddy/Caddyfile", import.meta.url));
const caddyEntrypoint = fileURLToPath(new URL("../deployment/dashboard-demo/caddy/entrypoint.sh", import.meta.url));
const onboardingScript = fileURLToPath(new URL("../deployment/dashboard-demo/scripts/onboard-organization.sh", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startAuth({ accessTtl = 900, idleTtl = 1800, seedUsers } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "tanaghom-auth-"));
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const keyFile = join(directory, "auth_private_key.pem");
  const seedFile = join(directory, "seed.json");
  const storeFile = join(directory, "auth-users.json");
  await writeFile(keyFile, privateKey, { mode: 0o600 });
  await writeFile(seedFile, JSON.stringify({
    users: seedUsers ?? [
      {
        email: "owner@example.test",
        password: "correct-horse-battery-staple",
        sub: "90000000-0000-4000-8000-000000000001",
      },
      {
        email: "second@example.test",
        password: "another-long-demo-passphrase",
        sub: "90000000-0000-4000-8000-000000000002",
      },
    ],
  }), { mode: 0o600 });

  const port = await freePort();
  const child = spawn(process.execPath, [join(authDir, "server.mjs")], {
    cwd: authDir,
    env: {
      ...process.env,
      DEMO_AUTH_PORT: String(port),
      DEMO_AUTH_ISSUER: `http://127.0.0.1:${port}/auth/v1`,
      AUTH_STORE_FILE: storeFile,
      AUTH_SEED_FILE: seedFile,
      AUTH_PRIVATE_KEY_FILE: keyFile,
      AUTH_ACCESS_TTL_SECONDS: String(accessTtl),
      AUTH_IDLE_TTL_SECONDS: String(idleTtl),
      AUTH_ABSOLUTE_TTL_SECONDS: "3600",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`auth server exited early: ${logs}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`auth server did not become healthy: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    base,
    directory,
    storeFile,
    seedFile,
    keyFile,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function login(base, email, password) {
  const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test("accounts are stored as scrypt hashes, login is rate limited, and password change revokes sessions", async () => {
  const auth = await startAuth();
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failure = await login(auth.base, "owner@example.test", `wrong-password-${attempt}`);
      assert.equal(failure.status, 401);
    }
    const blocked = await login(auth.base, "owner@example.test", "correct-horse-battery-staple");
    assert.equal(blocked.status, 429, "the sixth attempt must be rate limited");
    assert.ok(blocked.body.retry_after > 0);

    const storeText = await readFile(auth.storeFile, "utf8");
    assert.ok(storeText.includes("scrypt$"), "store must contain scrypt hashes");
    assert.ok(!storeText.includes("correct-horse-battery-staple"), "plaintext must not survive migration");
    assert.ok(!storeText.includes("another-long-demo-passphrase"));
    assert.equal((await readFile(auth.storeFile)).length > 0, true);

    const session = await login(auth.base, "second@example.test", "another-long-demo-passphrase");
    assert.equal(session.status, 200);
    assert.ok(session.body.access_token);
    assert.equal(session.body.expires_in, 900);

    const wrongCurrent = await fetch(`${auth.base}/auth/v1/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.body.access_token}` },
      body: JSON.stringify({ current_password: "not-the-password", new_password: "brand-new-long-passphrase" }),
    });
    assert.equal(wrongCurrent.status, 400);
    assert.equal((await wrongCurrent.json()).error, "invalid_current_password");

    const weak = await fetch(`${auth.base}/auth/v1/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.body.access_token}` },
      body: JSON.stringify({
        current_password: "another-long-demo-passphrase",
        new_password: "tanaghom-password",
      }),
    });
    assert.equal(weak.status, 400);
    assert.ok(["password_too_common", "password_too_simple", "password_contains_email"].includes((await weak.json()).error));

    const changed = await fetch(`${auth.base}/auth/v1/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.body.access_token}` },
      body: JSON.stringify({
        current_password: "another-long-demo-passphrase",
        new_password: "a-fresh-and-unrelated-passphrase",
      }),
    });
    assert.equal(changed.status, 200);

    const refresh = await fetch(`${auth.base}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.body.refresh_token }),
    });
    assert.equal(refresh.status, 401, "password change must revoke refresh tokens");

    assert.equal((await login(auth.base, "second@example.test", "another-long-demo-passphrase")).status, 401);
    const fresh = await login(auth.base, "second@example.test", "a-fresh-and-unrelated-passphrase");
    assert.equal(fresh.status, 200);

    const identity = await fetch(`${auth.base}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${fresh.body.access_token}` },
    });
    assert.equal(identity.status, 200);
    assert.equal((await identity.json()).email, "second@example.test");
  } finally {
    await auth.stop();
  }
});

test("access tokens expire, and an operator-created account must choose a password", async () => {
  const auth = await startAuth({ accessTtl: 1 });
  try {
    const session = await login(auth.base, "owner@example.test", "correct-horse-battery-staple");
    assert.equal(session.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    const expired = await fetch(`${auth.base}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${session.body.access_token}` },
    });
    assert.equal(expired.status, 401);

    const created = spawnSync(process.execPath, [
      join(authDir, "admin.mjs"),
      "upsert",
      "--email", "operator-created@example.test",
      "--name", "Operator Created",
      "--stdin-password",
    ], {
      cwd: authDir,
      input: "operator-chosen-long-passphrase-2026\n",
      env: {
        ...process.env,
        AUTH_STORE_FILE: auth.storeFile,
        AUTH_SEED_FILE: auth.seedFile,
      },
      encoding: "utf8",
    });
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /SUB=[0-9a-f-]{36}/);
    assert.ok(!created.stdout.includes("operator-chosen-long-passphrase-2026"), "the CLI must never echo a password");

    const firstLogin = await login(auth.base, "operator-created@example.test", "operator-chosen-long-passphrase-2026");
    assert.equal(firstLogin.status, 200);
    assert.equal(firstLogin.body.must_change_password, true);

    const setPassword = await fetch(`${auth.base}/auth/v1/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${firstLogin.body.access_token}` },
      body: JSON.stringify({ password: "chosen-on-first-sign-in-2026" }),
    });
    assert.equal(setPassword.status, 200);

    const afterChange = await login(auth.base, "operator-created@example.test", "chosen-on-first-sign-in-2026");
    assert.equal(afterChange.status, 200);
    assert.equal(afterChange.body.must_change_password, false);
  } finally {
    await auth.stop();
  }
});

test("the public edge and onboarding guardrails are declared in source", async () => {
  const compose = await readFile(composePath, "utf8");
  assert.match(compose, /profiles: \[https\]/);
  assert.match(compose, /caddy:2\.10\.2-alpine@sha256:[0-9a-f]{64}/);
  assert.match(compose, /"80:80"/);
  assert.match(compose, /"443:443"/);
  assert.match(compose, /127\.0\.0\.1:3210:3000/);
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

  if (process.platform !== "win32") {
    const syntax = spawnSync("bash", ["-n", onboardingScript], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
    const refused = spawnSync("sh", [caddyEntrypoint], {
      env: { ...process.env, TANAGHOM_PUBLIC_DOMAIN: "localhost", TANAGHOM_POSTIZ_DOMAIN: "localhost" },
      encoding: "utf8",
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refusing to start Caddy/);
  }
});
