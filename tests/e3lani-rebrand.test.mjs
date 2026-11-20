import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const ALLOWED_INTERNAL_PATTERNS = [
  /tanaghom:identity-changed/,
  /tanaghom:locale-change/,
  /tanaghom_access_token/,
  /tanaghom_locale/,
  /tanaghomChannels/,
  /brand\/tanaghom/,
  /tanaghom\.agent-registry\.v1/,
  /tanaghom\.skill-registry\.v1/,
  /http:\/\/tanaghom\.internal/,
  /@tanaghom\//,
];

test("user-facing dashboard UI, auth mailer, and workspace prompts contain zero Tanaghom or تناغم leaks", () => {
  const files = [
    ...walk(path.join(root, "apps", "dashboard", "components")),
    ...walk(path.join(root, "apps", "dashboard", "lib", "i18n")),
    path.join(root, "apps", "dashboard", "app", "layout.tsx"),
    path.join(root, "apps", "dashboard", "app", "login", "page.tsx"),
    path.join(root, "apps", "dashboard", "app", "signup", "page.tsx"),
    path.join(root, "deployment", "dashboard-demo", "auth", "mailer.mjs"),
    path.join(root, "packages", "agent-runtime", "workspace.mjs"),
    path.join(root, "packages", "agent-runtime", "workspace-gemma.mjs"),
  ];

  const violations = [];
  for (const file of files) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (!/tanaghom|تناغم/i.test(line)) return;
      if (ALLOWED_INTERNAL_PATTERNS.some((pattern) => pattern.test(line))) return;
      violations.push(`${rel}:${idx + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(violations, [], `Unexpected user-facing Tanaghom/تناغم strings:\n${violations.join("\n")}`);
});

test("E3lani / إعلاني brand copy is wired consistently and never uses 'E3lani Online'", () => {
  const layout = readFileSync(path.join(root, "apps", "dashboard", "app", "layout.tsx"), "utf8");
  const publicPages = readFileSync(path.join(root, "apps", "dashboard", "components", "public-pages.tsx"), "utf8");
  const appShell = readFileSync(path.join(root, "apps", "dashboard", "components", "app-shell.tsx"), "utf8");
  const authShell = readFileSync(path.join(root, "apps", "dashboard", "components", "auth-shell.tsx"), "utf8");
  const mailer = readFileSync(path.join(root, "deployment", "dashboard-demo", "auth", "mailer.mjs"), "utf8");
  const workspacePrompt = readFileSync(path.join(root, "packages", "agent-runtime", "workspace.mjs"), "utf8");

  assert.match(layout, /title:\s*\{\s*default:\s*"E3lani",\s*template:\s*"%s · E3lani"\s*\}/);
  assert.match(publicPages, /<span>\{ar \? "إعلاني" : "E3lani"\}<\/span>/);
  assert.match(appShell, /<span>\{ar \? "إعلاني" : "E3lani"\}<\/span>/);
  assert.match(authShell, /<span>\{ar \? "إعلاني" : "E3lani"\}<\/span>/);
  assert.match(mailer, /Verify your E3lani email \/ تحقق من بريدك في إعلاني/);
  assert.match(workspacePrompt, /in E3lani's bounded specialist team/);
  assert.match(workspacePrompt, /Keep the brand name إعلاني/);

  for (const content of [layout, publicPages, appShell, authShell, mailer, workspacePrompt]) {
    assert.doesNotMatch(content, /E3lani Online/i);
  }
});

test("internal cookies, DOM events, and package names stay unchanged", () => {
  const useLocale = readFileSync(path.join(root, "apps", "dashboard", "lib", "client", "use-locale.ts"), "utf8");
  const creativeI18n = readFileSync(path.join(root, "apps", "dashboard", "lib", "i18n", "creative.ts"), "utf8");
  const tenantName = readFileSync(path.join(root, "apps", "dashboard", "components", "tenant-name.tsx"), "utf8");
  const homePage = readFileSync(path.join(root, "apps", "dashboard", "app", "page.tsx"), "utf8");

  assert.match(useLocale, /"tanaghom:locale-change"/);
  assert.match(creativeI18n, /"tanaghom_locale"/);
  assert.match(tenantName, /"tanaghom:identity-changed"/);
  assert.match(homePage, /"tanaghom_access_token"/);
});
