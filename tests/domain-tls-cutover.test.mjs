import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  appHref,
  getAppOrigin,
  getMarketingOrigin,
  isAppHost,
  isMarketingHost,
  isSplitDomainMode,
  marketingHref,
  normalizeRequestHost,
} from "../apps/dashboard/lib/public-urls.ts";

const root = path.resolve(import.meta.dirname, "..");

test("public-urls supports single-domain mode cleanly with relative links", () => {
  const env = { APP_BASE_URL: "https://app.16.192.10.126.sslip.io", PUBLIC_MARKETING_URL: "" };
  assert.equal(getAppOrigin(env), "https://app.16.192.10.126.sslip.io");
  assert.equal(getMarketingOrigin(env), "");
  assert.equal(isSplitDomainMode(env), false);
  assert.equal(appHref("/login", env), "/login");
  assert.equal(marketingHref("/pricing", env), "/pricing");
  assert.equal(isMarketingHost("app.16.192.10.126.sslip.io", env), false);
  assert.equal(isAppHost("app.16.192.10.126.sslip.io", env), true);
});

test("public-urls splits www.e3lani.online marketing and app.e3lani.online app origins", () => {
  const env = {
    APP_BASE_URL: "https://app.e3lani.online/",
    PUBLIC_MARKETING_URL: "https://www.e3lani.online/",
  };
  assert.equal(getAppOrigin(env), "https://app.e3lani.online");
  assert.equal(getMarketingOrigin(env), "https://www.e3lani.online");
  assert.equal(isSplitDomainMode(env), true);
  assert.equal(appHref("/login", env), "https://app.e3lani.online/login");
  assert.equal(appHref("/signup", env), "https://app.e3lani.online/signup");
  assert.equal(marketingHref("/", env), "https://www.e3lani.online/");
  assert.equal(marketingHref("/pricing", env), "https://www.e3lani.online/pricing");
  assert.equal(normalizeRequestHost("www.e3lani.online, 10.0.0.1"), "www.e3lani.online");
  assert.equal(isMarketingHost("WWW.E3LANI.ONLINE", env), true);
  assert.equal(isMarketingHost("app.e3lani.online", env), false);
  assert.equal(isAppHost("app.e3lani.online", env), true);
  assert.equal(isAppHost("www.e3lani.online", env), false);
});

test("public-urls rejects invalid or credential-bearing origins", () => {
  const env = {
    APP_BASE_URL: "https://user:pass@app.e3lani.online",
    PUBLIC_MARKETING_URL: "javascript:alert(1)",
  };
  assert.equal(getAppOrigin(env), "");
  assert.equal(getMarketingOrigin(env), "");
  assert.equal(isSplitDomainMode(env), false);
});

test("compose, .env.example, and validate-compose wire marketing and apex domains", () => {
  const compose = readFileSync(path.join(root, "deployment/dashboard-demo/compose.yml"), "utf8");
  const envExample = readFileSync(path.join(root, "deployment/dashboard-demo/.env.example"), "utf8");
  const validator = readFileSync(path.join(root, "deployment/dashboard-demo/scripts/validate-compose.py"), "utf8");
  const smoke = readFileSync(path.join(root, "deployment/dashboard-demo/scripts/smoke.mjs"), "utf8");

  assert.match(compose, /PUBLIC_MARKETING_URL:\s*\$\{PUBLIC_MARKETING_URL:-\}/);
  assert.match(compose, /TANAGHOM_MARKETING_DOMAIN:\s*\$\{TANAGHOM_MARKETING_DOMAIN:-\}/);
  assert.match(compose, /TANAGHOM_APEX_DOMAIN:\s*\$\{TANAGHOM_APEX_DOMAIN:-\}/);
  assert.match(envExample, /TANAGHOM_MARKETING_DOMAIN=/);
  assert.match(envExample, /TANAGHOM_APEX_DOMAIN=/);
  assert.match(envExample, /PUBLIC_MARKETING_URL=/);
  assert.match(validator, /TANAGHOM_MARKETING_DOMAIN/);
  assert.match(validator, /TANAGHOM_APEX_DOMAIN/);
  assert.match(validator, /PUBLIC_MARKETING_URL/);
  assert.match(smoke, /await page\(ownerJar, "\/", "E3lani"\)/);
});

test("Caddy entrypoint renders split-domain TLS config with apex 301 and app noindex", () => {
  const entrypoint = path.join(root, "deployment/dashboard-demo/caddy/entrypoint.sh");
  const script = readFileSync(entrypoint, "utf8");

  assert.match(script, /X-Robots-Tag "noindex, nofollow"/);
  assert.match(script, /redir @marketingCanonical https:\/\/\{\$TANAGHOM_MARKETING_DOMAIN\}\{uri\} 301/);
  assert.match(script, /redir https:\/\/\{\$TANAGHOM_MARKETING_DOMAIN\}\{uri\} 301/);
  assert.match(script, /redir https:\/\/\{\$TANAGHOM_PUBLIC_DOMAIN\}\{uri\} 302/);
  assert.match(script, /@postizRegister path \/api\/auth\/register\*/);
  assert.match(script, /TANAGHOM_APEX_DOMAIN requires TANAGHOM_MARKETING_DOMAIN/);

  if (process.platform !== "win32") {
    const syntax = spawnSync("sh", ["-n", entrypoint], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);

    const tempDir = mkdtempSync(path.join(tmpdir(), "e3lani-caddy-"));
    try {
      const renderedPath = path.join(tempDir, "Caddyfile");
      const ok = spawnSync("sh", [entrypoint], {
        env: {
          ...process.env,
          TANAGHOM_PUBLIC_DOMAIN: "app.e3lani.online",
          TANAGHOM_MARKETING_DOMAIN: "www.e3lani.online",
          TANAGHOM_APEX_DOMAIN: "e3lani.online",
          TANAGHOM_POSTIZ_DOMAIN: "social.16.192.10.126.sslip.io",
          TANAGHOM_ACME_EMAIL: "ops@e3lani.online",
          CADDY_RENDERED_CONFIG: renderedPath,
          CADDY_ENTRYPOINT_RENDER_ONLY: "1",
        },
        encoding: "utf8",
      });
      assert.equal(ok.status, 0, ok.stderr);
      const rendered = readFileSync(renderedPath, "utf8");
      assert.match(rendered, /\{\$TANAGHOM_PUBLIC_DOMAIN\}/);
      assert.match(rendered, /\{\$TANAGHOM_MARKETING_DOMAIN\}/);
      assert.match(rendered, /\{\$TANAGHOM_APEX_DOMAIN\}/);
      assert.match(rendered, /\{\$TANAGHOM_POSTIZ_DOMAIN\}/);
      assert.match(rendered, /X-Robots-Tag "noindex, nofollow"/);
      assert.match(rendered, /redir https:\/\/\{\$TANAGHOM_MARKETING_DOMAIN\}\{uri\} 301/);

      const apexNoMarketing = spawnSync("sh", [entrypoint], {
        env: {
          ...process.env,
          TANAGHOM_PUBLIC_DOMAIN: "app.e3lani.online",
          TANAGHOM_APEX_DOMAIN: "e3lani.online",
          TANAGHOM_POSTIZ_DOMAIN: "social.16.192.10.126.sslip.io",
          CADDY_ENTRYPOINT_RENDER_ONLY: "1",
        },
        encoding: "utf8",
      });
      assert.equal(apexNoMarketing.status, 1);
      assert.match(apexNoMarketing.stderr, /TANAGHOM_APEX_DOMAIN requires TANAGHOM_MARKETING_DOMAIN/);

      const loop = spawnSync("sh", [entrypoint], {
        env: {
          ...process.env,
          TANAGHOM_PUBLIC_DOMAIN: "app.e3lani.online",
          TANAGHOM_MARKETING_DOMAIN: "e3lani.online",
          TANAGHOM_APEX_DOMAIN: "e3lani.online",
          TANAGHOM_POSTIZ_DOMAIN: "social.16.192.10.126.sslip.io",
          CADDY_ENTRYPOINT_RENDER_ONLY: "1",
        },
        encoding: "utf8",
      });
      assert.equal(loop.status, 1);
      assert.match(loop.stderr, /must be distinct/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("split-domain Next.js pages wire appOrigin and marketingOrigin cleanly", () => {
  const home = readFileSync(path.join(root, "apps/dashboard/app/page.tsx"), "utf8");
  const publicPages = readFileSync(path.join(root, "apps/dashboard/components/public-pages.tsx"), "utf8");
  const pricing = readFileSync(path.join(root, "apps/dashboard/app/pricing/page.tsx"), "utf8");
  const privacy = readFileSync(path.join(root, "apps/dashboard/app/privacy/page.tsx"), "utf8");
  const terms = readFileSync(path.join(root, "apps/dashboard/app/terms/page.tsx"), "utf8");
  const login = readFileSync(path.join(root, "apps/dashboard/app/login/page.tsx"), "utf8");
  const signup = readFileSync(path.join(root, "apps/dashboard/app/signup/page.tsx"), "utf8");

  assert.match(home, /isMarketingHost\(host\)/);
  assert.match(home, /isAppHost\(host\)/);
  assert.match(home, /redirect\("\/login"\)/);
  assert.match(publicPages, /function AppNavLink/);
  for (const page of [pricing, privacy, terms]) {
    assert.match(page, /getAppOrigin\(\)/);
    assert.match(page, /appOrigin=\{appOrigin\}/);
  }
  for (const page of [login, signup]) {
    assert.match(page, /getMarketingOrigin\(\)/);
    assert.match(page, /marketingOrigin\/pricing|`\$\{marketingOrigin\}\/pricing`/);
  }
});
