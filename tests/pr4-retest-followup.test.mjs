import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { keyExcerpt } from "../packages/agent-runtime/workspace.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const requireCjs = createRequire(import.meta.url);
const ts = requireCjs("typescript");

function transpile(source, fileName = "module.ts") {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
}

function evaluate(source, names, context = {}) {
  const keys = Object.keys(context);
  const factory = new Function(...keys, "exports", "module", "require", `${transpile(source)}\nreturn { ${names.join(", ")} };`);
  const module = { exports: {} };
  return factory(...keys.map((key) => context[key]), module.exports, module, (id) => {
    throw new Error(`unexpected import: ${id}`);
  });
}

/** The pure /campaigns helpers, lifted out of the component and run for real. */
function campaignsHelpers() {
  const source = read("apps/dashboard/components/campaigns-view.tsx");
  const start = source.indexOf("function label(");
  const end = source.indexOf("const errorMessages");
  assert.ok(start > 0 && end > start, "campaigns helpers are extractable");
  return evaluate(source.slice(start, end), ["stage", "statusLabel"]);
}

/** The dependency row helper, lifted out of DependenciesPanel and run for real. */
function loadIntegration(connection, text = textCopy.en, date = (value) => value) {
  const source = read("apps/dashboard/components/system-view.tsx");
  const start = source.indexOf("  const integration = ");
  const end = source.indexOf("  const postiz = integration(");
  assert.ok(start > 0 && end > start, "integration helper is extractable");
  return evaluate(source.slice(start, end), ["integration"], { connection, text, date, lang: "en" }).integration;
}

const textCopy = {
  en: {
    connected: "Connected",
    notTested: "Not tested",
    configuredNoTest: "Configured · no connection test recorded",
    notConfigured: "Not configured",
    lastTested: "Last tested",
    noConnectionTest: "No connection test recorded",
  },
};

test("campaigns never show a second, contradictory status under the title", () => {
  const { stage, statusLabel } = campaignsHelpers();

  assert.equal(statusLabel("waiting_review", false), "Ready for your review");
  assert.equal(statusLabel("rejected", false), "Changes requested");

  // A work pack with no active workflow job renders no extra line at all.
  for (const status of ["waiting_review", "rejected", "approved", "queued", "running", "failed", "cancelled"]) {
    assert.equal(stage(status, null, null, false), statusLabel(status, false), `${status} matches its pill`);
    assert.notEqual(stage(status, null, null, false), "Waiting Review");
    assert.notEqual(stage(status, null, null, false), "Rejected");
  }

  // Genuine workflow stages still differ from the pill, so they keep showing.
  assert.equal(stage("strategy_ready", null, null, false), "Strategy");
  assert.equal(stage("content_in_progress", null, null, false), "Content review");
  assert.equal(stage("active", null, null, false), "Ready for handoff");
  assert.notEqual(stage("active", null, null, false), statusLabel("active", false));
  // A running job is labelled with the same vocabulary as the pill.
  assert.equal(stage("strategy_ready", "campaign.strategy.generate", "running", false), "Strategy · Working");
  assert.equal(stage("strategy_ready", "campaign.strategy.generate", "waiting_review", false), "Strategy · Ready for your review");

  // Arabic keeps the identical wording in both places.
  for (const status of ["waiting_review", "rejected", "approved"]) {
    assert.equal(stage(status, null, null, true), statusLabel(status, true));
  }
});

test("an untested social or CRM connection is never reported as connected", () => {
  const records = [
    { provider: "postiz", status: "connected", last_tested_at: null },
    { provider: "ghl", status: "connected", last_tested_at: null },
  ];
  const untested = loadIntegration((name) => records.find((record) => record.provider === name));
  for (const provider of ["postiz", "ghl"]) {
    assert.deepEqual(untested(provider), ["Not tested", "neutral", "Configured · no connection test recorded"], provider);
  }

  // A recorded test keeps the genuine success state.
  const tested = loadIntegration(() => ({ provider: "postiz", status: "connected", last_tested_at: "2026-11-20T09:00:00Z" }));
  assert.deepEqual(tested("postiz"), ["Connected", "success", "Last tested 2026-11-20T09:00:00Z"]);

  // A connection that is not connected never claims success either.
  const configured = loadIntegration(() => ({ provider: "ghl", status: "configured", last_tested_at: null }));
  assert.deepEqual(configured("ghl"), ["configured", "neutral", "No connection test recorded"]);

  // Both rows are built by the helper, and the contradicting copy is gone.
  const source = read("apps/dashboard/components/system-view.tsx");
  assert.match(source, /\[text\.socialPublishing, postiz\[0\], postiz\[1\], postiz\[2\]\]/);
  assert.match(source, /\[text\.crmIntegration, crm\[0\], crm\[1\], crm\[2\]\]/);
  assert.doesNotMatch(source, /connectedNoTest/);
  assert.match(source, /notTested: "Not tested"/);
  assert.match(source, /configuredNoTest: "Configured · no connection test recorded"/);
  assert.match(source, /notTested: "لم يُختبر"/);
  assert.match(source, /configuredNoTest: "مهيّأ · لا يوجد سجل لاختبار الاتصال"/);
});

test("the timezone note lives outside the footer block that is hidden on desktop", () => {
  const shell = read("apps/dashboard/components/app-shell.tsx");
  const trustStart = shell.indexOf('<div className="sidebar-trust">');
  const trustEnd = shell.indexOf("</div>", trustStart);
  const timezone = shell.indexOf('className="sidebar-timezone"');

  assert.ok(trustStart > 0 && trustEnd > trustStart, ".sidebar-trust is still present");
  assert.ok(timezone > trustEnd, ".sidebar-timezone is not a child of .sidebar-trust");
  assert.ok(timezone < shell.indexOf('<div className="sidebar-locale">'), ".sidebar-timezone sits in the footer");

  const css = read("apps/dashboard/app/globals.css");
  assert.match(css, /\.sidebar-timezone \{ display: block; color: var\(--muted\); font-size: 0\.66rem; line-height: 1\.4; padding: 0\.25rem 0\.65rem 0\.45rem; \}/);
  assert.match(css, /\.sidebar-trust \{ display: none; \}/);
});

test("the overview headline counts the campaigns the table lists", () => {
  const overview = read("apps/dashboard/components/overview-dashboard.tsx");
  assert.match(overview, /const totalCampaigns = data\.campaigns\.length \|\| data\.summary\.campaigns_total;/);
  assert.match(
    overview,
    /\$\{totalCampaigns\} \$\{totalCampaigns === 1 \? "campaign" : "campaigns"\} \(\$\{data\.summary\.campaigns_active\} active\$\{changesRequested \? ` · \$\{changesRequested\} changes requested` : ""\}\)/,
  );
  assert.match(overview, /formatArabicCount\(totalCampaigns, \{ zero: "لا حملات"/);
  assert.match(overview, /· \$\{formatArabicCount\(changesRequested,/);
});

test("the executive-summary excerpt keeps bold labels and never cuts mid-word", () => {
  const document = [
    "## Executive summary",
    "",
    "**Opening:** Transform your bedroom into a sanctuary.",
    "",
    "**Body:** HomeStff bedding in three weights.",
    "",
    "**Call to Action:** Shop the collection.",
  ].join("\n");
  const excerpt = keyExcerpt(document);
  assert.match(excerpt, /\*\*Opening:\*\* Transform your bedroom into a sanctuary\./);
  assert.match(excerpt, /\*\*Body:\*\* HomeStff bedding in three weights\./);
  assert.match(excerpt, /\*\*Call to Action:\*\* Shop the collection\./);
  assert.doesNotMatch(excerpt, /[^*]\*[A-Za-z]/);

  // List bullets lose their marker, bold labels never lose an asterisk.
  assert.equal(keyExcerpt("- first bullet\n- second bullet"), "first bullet\nsecond bullet");
  assert.equal(keyExcerpt("**Bold:** value"), "**Bold:** value");

  // Long input is cut between words and never ends in a dangling marker.
  const words = Array.from({ length: 120 }, (_, index) => `token${index}`);
  const clipped = keyExcerpt(words.join(" "), 60);
  assert.ok(clipped.endsWith("…"), "long excerpts are marked as truncated");
  assert.ok(clipped.length <= 61);
  const head = clipped.slice(0, -1);
  for (const token of head.split(/\s+/)) assert.match(token, /^token\d+$/, `no mid-word cut: ${token}`);
  assert.doesNotMatch(clipped, /[*_`]\s*…$/);

  const trailing = keyExcerpt(`${"sentence ".repeat(40)}**`, 40);
  assert.ok(trailing.endsWith("…"));
  assert.doesNotMatch(trailing, /[*_`]\s*…$/);
});

test("stored summaries with a sliced bold marker render without literal asterisks", () => {
  const { parseMarkdown } = evaluate(read("apps/dashboard/lib/markdown.ts"), ["parseMarkdown"]);

  const values = (source) => {
    const nodes = [];
    for (const block of parseMarkdown(source)) {
      if (block.inline) nodes.push(...block.inline);
      if (block.items) for (const item of block.items) nodes.push(...item);
    }
    return nodes;
  };

  const legacy = values("*Opening:** Transform your bedroom.\n\n*Body:** Three weights.\n\n*Call to Action:** Shop now.");
  assert.ok(legacy.some((node) => node.type === "strong" && node.value === "Opening:"));
  assert.ok(legacy.some((node) => node.type === "strong" && node.value === "Body:"));
  assert.ok(legacy.some((node) => node.type === "strong" && node.value === "Call to Action:"));

  // A stored summary keeps its labels on consecutive lines, so they arrive in one paragraph.
  const stored = values("*Opening:** Transform your bedroom.\n*Body:** Three weights.\n*Call to Action:** Shop now.\n*…");
  for (const label of ["Opening:", "Body:", "Call to Action:"]) {
    assert.ok(stored.some((node) => node.type === "strong" && node.value === label), `${label} is bold`);
  }
  assert.ok(stored.some((node) => node.value.includes(" Transform your bedroom.")));

  const arabic = values("*الحقائق المؤكدة للمشروع:** أربع نقاط.");
  assert.ok(arabic.some((node) => node.type === "strong" && node.value === "الحقائق المؤكدة للمشروع:"));

  for (const node of [...legacy, ...arabic]) {
    assert.ok(!node.value.includes("*"), `no literal asterisk in ${JSON.stringify(node)}`);
  }

  // Marker-only leftovers and truncated openers are noise, not text.
  for (const source of ["Body line.\n\n*…\n", "Body line.\n\n**\n", "**Missing Information (Unconfirmed…", "Task 6 Executive Summary\n**Missing Information (Unconfirmed pricing…"]) {
    const nodes = values(source);
    assert.ok(nodes.every((node) => !node.value.includes("*")), `no strays for ${JSON.stringify(source)}`);
  }

  // A horizontal rule is still a rule, not a skipped marker line.
  assert.deepEqual(parseMarkdown("***"), [{ type: "rule" }]);
  // Intact bold still renders as bold.
  assert.deepEqual(values("**Opening:** The offer.")[0], { type: "strong", value: "Opening:" });
});

test("post-card SVG text keeps both preserve hints on all three text elements", () => {
  const cards = read("apps/dashboard/components/workspace-post-cards.tsx");
  const lines = cards.split(/\r?\n/).map((line) => line.trim());
  const xmlSpace = lines.flatMap((line, index) => (line === 'xmlSpace="preserve"' ? [index] : []));
  const whiteSpace = lines.flatMap((line, index) => (line === 'style={{ whiteSpace: "pre" }}' ? [index] : []));

  assert.equal(xmlSpace.length, 3, "headline, body and call to action");
  assert.equal(whiteSpace.length, 3, "every preserved text element also carries the SVG2 hint");
  for (const index of xmlSpace) {
    assert.equal(lines[index + 1], 'style={{ whiteSpace: "pre" }}', "both hints sit on the same text element");
  }
  assert.match(cards, /function svgTextRuns/);
  assert.match(cards, /\{svgTextRuns\(headlineLines\)\.map/);
  assert.match(cards, /\{svgTextRuns\(bodyLines\)\.map/);
  assert.match(cards, /\{svgTextRuns\(ctaLines\)\.map/);
});
