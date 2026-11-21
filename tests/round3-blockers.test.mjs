import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { customerBlockerCopy, uniqueBlockerConditions } from "../apps/dashboard/lib/agent-blocker-copy.ts";
import { parseMarkdown } from "../apps/dashboard/lib/markdown.ts";
import { AuthorizeUrlError, validateAuthorizeUrl } from "../apps/dashboard/lib/oauth-authorize-url.ts";
import { redactTaskReferences } from "../apps/dashboard/lib/redact-task-references.ts";
import { applyReviewFilters, clearedReviewFilters, reviewFiltersActive, reviewPositionLabel } from "../apps/dashboard/lib/review-filter.ts";
import { markdownExcerpt } from "../apps/dashboard/lib/truncate.ts";
import { workspaceArtifact as geminiWorkspaceArtifact } from "../packages/agent-runtime/workspace.mjs";
import { workspaceArtifact as gemmaWorkspaceArtifact } from "../packages/agent-runtime/workspace-gemma.mjs";

const requireCjs = createRequire(import.meta.url);
const ts = requireCjs("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Loads a .tsx component with real React so it can be rendered in this test. */
function loadTsx(path, extraImports = {}) {
  const js = ts.transpileModule(read(path), {
    fileName: path.split("/").pop(),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const resolve = (id) => {
    if (id in extraImports) return extraImports[id];
    if (id === "react") return requireCjs("react");
    if (id === "react/jsx-runtime") return requireCjs("react/jsx-runtime");
    if (id === "lucide-react") return { Search: () => null };
    throw new Error(`unexpected import in ${path}: ${id}`);
  };
  new Function("require", "module", "exports", js)(resolve, module, module.exports);
  return module.exports;
}

/** Text a FormattedText render would show, taken from the same parser it uses. */
function markdownText(text) {
  const inline = (nodes) => nodes.map((node) => node.value).join("");
  return parseMarkdown(text).map((block) => {
    if (block.type === "heading" || block.type === "paragraph" || block.type === "quote") return inline(block.inline);
    if (block.type === "list") return block.items.map(inline).join("\n");
    if (block.type === "code") return block.value;
    return "";
  }).join("\n");
}

const TASK_ID = "3f2b4c1e-9a7d-4f2b-8c31-1d5e6f7a8b90";
const SECOND_TASK_ID = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

// ---------------------------------------------------------------------------
// Blocker 1 — /content collapsed work packs must not show literal markdown
// ---------------------------------------------------------------------------

test("Blocker 1: a truncated work-pack excerpt renders without literal markdown markers", () => {
  const document = [
    "# Digital marketing course — January cohort",
    "",
    "## Post 1",
    "",
    "**Opening:** Transform your home into a peaceful sanctuary before the season ends.",
    "",
    "- *Fast delivery* on every order",
    "- **Bold claim** that keeps going so the excerpt has to cut inside a paragraph rather than at its end",
  ].join("\n");

  const excerpt = markdownExcerpt(document, 120);
  assert.ok(excerpt.length > 0);
  assert.ok(excerpt.endsWith("…"), "a shortened excerpt keeps its ellipsis");

  const rendered = markdownText(excerpt);
  assert.doesNotMatch(rendered, /[#*]/, `literal markdown leaked: ${rendered}`);

  // Dropping markdown inside truncate.ts is not the fix: an untruncated excerpt
  // keeps its balanced markers for <FormattedText> to interpret.
  assert.match(markdownExcerpt(document, 4000), /\*\*Opening:\*\*/);
  assert.match(markdownExcerpt(document, 4000), /\*Fast delivery\*/);

  const library = read("apps/dashboard/components/content-library.tsx");
  assert.match(library, /<FormattedText text={markdownExcerpt\(redactTaskReferences\(deliverable\.document\), 160\)} \/>/);
});

// ---------------------------------------------------------------------------
// Blocker 2 — filtering to zero matches keeps the toolbar, the empty state and
// a working Clear filters control on /actions and /approvals
// ---------------------------------------------------------------------------

const { ReviewFilterBar } = loadTsx("apps/dashboard/components/review-filter-bar.tsx");

function renderBar(overrides = {}) {
  return renderToStaticMarkup(createElement(ReviewFilterBar, {
    ar: false,
    query: "no-such-lead",
    onQuery: () => {},
    searchLabel: "Search actions",
    placeholder: "Search lead, channel, or action",
    compact: true,
    showEmpty: true,
    emptyMessage: "No actions match this view. Clear the search or change the status.",
    filtersActive: true,
    onClear: () => {},
    selects: [
      { label: "Status", value: "all", options: [{ value: "all", label: "All statuses" }], onChange: () => {} },
      { label: "Sort", value: "newest", options: [{ value: "newest", label: "Newest first" }], onChange: () => {} },
    ],
    ...overrides,
  }));
}

test("Blocker 2: the review filter bar still renders its toolbar and Clear filters at zero matches", () => {
  const html = renderBar();
  assert.match(html, /class="list-toolbar list-toolbar-compact"/);
  assert.match(html, /class="search-field"/);
  assert.match(html, /class="list-select"/);
  assert.match(html, /No actions match this view\./);
  assert.match(html, />Clear filters</);
  assert.match(html, /class="list-filter-empty-state"/);

  // Without an active filter the button is not offered, but the toolbar and the
  // empty state are still rendered.
  const unfiltered = renderBar({ filtersActive: false, query: "" });
  assert.match(unfiltered, /class="list-toolbar list-toolbar-compact"/);
  assert.doesNotMatch(unfiltered, />Clear filters</);

  // With matches the empty state is gone and the toolbar remains.
  const populated = renderBar({ showEmpty: false });
  assert.match(populated, /class="list-toolbar list-toolbar-compact"/);
  assert.doesNotMatch(populated, /list-filter-empty-state/);
});

test("Blocker 2: driving the filters to zero matches leaves no records and Clear restores them", () => {
  const actions = [
    { id: "a", title: "Follow up · Dana", status: "awaiting_approval", channel: "email", created_at: "2026-11-01T10:00:00Z" },
    { id: "b", title: "Book meeting · Omar", status: "indeterminate", channel: "sms", created_at: "2026-11-02T10:00:00Z" },
    { id: "c", title: "Qualify · Lina", status: "awaiting_approval", channel: "whatsapp", created_at: "2026-11-03T10:00:00Z" },
  ];
  const filter = (overrides = {}) => applyReviewFilters(actions, {
    query: "",
    sort: "newest",
    haystack: (item) => `${item.title} ${item.channel}`,
    title: (item) => item.title,
    createdAt: (item) => item.created_at,
    ...overrides,
  });

  assert.equal(filter({ query: "no-such-lead" }).length, 0);
  assert.equal(filter({ query: "", matches: (item) => item.status === "rejected" }).length, 0);
  assert.equal(filter().length, 3);
  assert.deepEqual(filter().map((item) => item.id), ["c", "b", "a"]);

  const cleared = clearedReviewFilters();
  assert.equal(cleared.query, "");
  assert.equal(cleared.filter, "all");
  assert.equal(cleared.sort, "newest");
  const restored = filter({ query: cleared.query, sort: cleared.sort, matches: (item) => cleared.filter === "all" || item.status === cleared.filter });
  assert.equal(restored.length, 3, "Clear filters restores the full queue");

  assert.equal(reviewFiltersActive("", "all", "all", "newest"), false);
  assert.equal(reviewFiltersActive("dana", "all", "all", "newest"), true);
  assert.equal(reviewFiltersActive("", "content", "all", "newest"), true);
});

test("Blocker 2: an item outside the filtered view has no position label (no '0 of 0')", () => {
  assert.equal(reviewPositionLabel(-1, 3), "");
  assert.equal(reviewPositionLabel(-1, 0), "");
  assert.equal(reviewPositionLabel(0, 3), "1 of 3");
  assert.equal(reviewPositionLabel(2, 3, "ar"), "3 من 3");

  const approvals = read("apps/dashboard/components/approval-workspace.tsx");
  assert.match(approvals, /\{activeInView && active \? <article className="review-canvas"/);
  assert.match(approvals, /\{reviewPositionLabel\(activeIndex, visible\.length, locale\) \? <span>/);
  // The queue shell no longer depends on a selected item.
  assert.match(approvals, /\{loadState === "ready" && items\.length \? \(/);

  const actions = read("apps/dashboard/components/ghl-action-review.tsx");
  assert.match(actions, /\{state === "ready" && payload && payload\.items\.length \? <div className="action-review-shell">/);
  assert.match(actions, /<ReviewFilterBar/);
  assert.match(actions, /\{active \? <article className="action-review-detail"/);
});

// ---------------------------------------------------------------------------
// Blocker 3 — RTL scaled previews stay inside a narrow container
// ---------------------------------------------------------------------------

/** Reads one CSS rule body from the creative stylesheet. */
function rule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start));
}

/**
 * Where a scaled 1080px iframe lands inside a container, per the CSS above.
 * The anchored edge stays put and the box shrinks toward the transform origin,
 * so the visible box is [element + o - o*scale, element + o + (W - o)*scale].
 */
function previewBox({ containerWidth, canvasWidth, anchorPhysical, originPhysical }) {
  const scale = containerWidth / canvasWidth;
  const elementLeft = anchorPhysical === "right" ? containerWidth - canvasWidth : 0;
  const originOffset = originPhysical === "right" ? canvasWidth : 0;
  return {
    scale,
    left: elementLeft + originOffset - originOffset * scale,
    right: elementLeft + originOffset + (canvasWidth - originOffset) * scale,
  };
}

test("Blocker 3: in RTL at 390px the scaled 1:1, 4:5 and 9:16 previews stay inside the frame", () => {
  const css = read("apps/dashboard/app/creative.css");
  const base = rule(css, ".creative-scaled-frame iframe");
  const rtl = rule(css, ":dir(rtl) .creative-scaled-frame iframe");

  assert.match(base, /inset-inline-start: 0/, "the frame anchors the iframe at its inline start");
  assert.match(base, /transform-origin: top left/);
  assert.match(rtl, /transform-origin: top right/, "RTL scales toward the right edge");
  // The regression: anchoring at inset-inline-end (left in RTL) while scaling
  // toward the right edge pushed the canvas out of the frame entirely.
  assert.doesNotMatch(rtl, /inset-inline-end|inset-inline-start:\s*auto/);

  const anchorPhysical = /inset-inline-end/.test(rtl) || /inset-inline-start:\s*auto/.test(rtl) ? "left" : "right";
  const originPhysical = /top right/.test(rtl) ? "right" : "left";
  for (const height of [1080, 1350, 1920]) {
    const box = previewBox({ containerWidth: 390, canvasWidth: 1080, anchorPhysical, originPhysical });
    assert.ok(box.left >= -0.5 && box.right <= 390.5, `${height}: box ${box.left}..${box.right} is inside 0..390`);
    assert.ok(Math.abs(box.right - box.left - 390) < 1, `${height}: scaled canvas fills the frame width`);
  }

  // The layout model detects the old CSS, so this test fails if the override returns.
  const broken = previewBox({ containerWidth: 390, canvasWidth: 1080, anchorPhysical: "left", originPhysical: "right" });
  assert.ok(broken.left > 390 || broken.right <= 0, "the removed override put the frame off-screen");

  // LTR stays untouched.
  const ltr = previewBox({ containerWidth: 390, canvasWidth: 1080, anchorPhysical: "left", originPhysical: "left" });
  assert.ok(ltr.left >= -0.5 && ltr.right <= 390.5);

  const motion = read("apps/dashboard/components/creative/motion-editor-view.tsx");
  assert.match(motion, /height={spec\.canvas\?\.height \?\? 1080}/);
});

// ---------------------------------------------------------------------------
// Item 17 — UUID redaction: render-time safety net plus clean generation
// ---------------------------------------------------------------------------

test("Item 17: stored task-reference lines are removed from EN, AR and Gemma summaries, other lines untouched", () => {
  const english = [
    "Executive delivery summary — Launch",
    "",
    "Brief: A course launch.",
    "Saved deliverables: 6 of 6",
    "",
    "Specialist deliverables",
    "",
    "1. Social Media Strategist",
    `Task reference: ${TASK_ID}`,
    "AI units: 120",
    "Key excerpt",
    "Grow reach with weekly posts.",
    "",
    "2. Content Creator",
    `Task reference: ${SECOND_TASK_ID}`,
    "AI units: 90",
  ].join("\n");
  const redacted = redactTaskReferences(english);
  assert.doesNotMatch(redacted, new RegExp(TASK_ID, "i"));
  assert.doesNotMatch(redacted, new RegExp(SECOND_TASK_ID, "i"));
  assert.doesNotMatch(redacted, /Task reference/i);
  for (const line of ["Brief: A course launch.", "AI units: 120", "Grow reach with weekly posts.", "AI units: 90"]) {
    assert.ok(redacted.split("\n").includes(line), `kept line: ${line}`);
  }
  assert.ok(redacted.includes("1. Social Media Strategist"));
  assert.ok(redacted.includes("2. Content Creator"));

  const arabic = [
    "ملخص التسليم التنفيذي — إطلاق",
    "",
    "الموجز: حملة دورة.",
    `1. استراتيجي التواصل الاجتماعي`,
    `مرجع المهمة: ${TASK_ID}`,
    "وحدات الذكاء الاصطناعي: 120",
  ].join("\n");
  const redactedAr = redactTaskReferences(arabic);
  assert.doesNotMatch(redactedAr, new RegExp(TASK_ID, "i"));
  assert.doesNotMatch(redactedAr, /مرجع المهمة/);
  assert.ok(redactedAr.includes("وحدات الذكاء الاصطناعي: 120"));

  const relaxed = `Task reference: ${TASK_ID}\nEverything after it stays.`;
  assert.equal(redactTaskReferences(relaxed), "Everything after it stays.");

  // A document without identifiers is returned byte-identical.
  const clean = "# Draft\n\nNo identifiers here.\n";
  assert.equal(redactTaskReferences(clean), clean);
});

test("Item 17: /approvals and /content render summaries through the redactor", () => {
  const approvals = read("apps/dashboard/components/approval-workspace.tsx");
  assert.match(approvals, /<FormattedText text={redactTaskReferences\(withoutDuplicateHeading\(deliverable\.document/);
  assert.match(approvals, /<FormattedText text={redactTaskReferences\(`\$\{deliverable\.excerpt\}/);

  const library = read("apps/dashboard/components/content-library.tsx");
  assert.match(library, /<FormattedText text={redactTaskReferences\(deliverable\.document\)} \/>/);

  const workspace = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(workspace, /redactTaskReferences\(step\.result\.document\)/);
  assert.equal((workspace.match(/redactTaskReferences\(s\.result!\.document\)/g) || []).length, 2);
});

test("Item 17: a freshly generated summary contains no task-reference lines", () => {
  const taskId = TASK_ID;
  const steps = [
    { profile: "social_media_strategist", task_id: taskId, document: "## Plan\n\nWeekly posts and one carousel.", response_hash: "h1", usage: { total_tokens: 120 }, elapsed_ms: 1400 },
    { profile: "content_creator", task_id: SECOND_TASK_ID, document: "## Post 1\n\n**Opening:** Learn with us.", response_hash: "h2", usage: { total_tokens: 210 }, elapsed_ms: 2600 },
  ];

  for (const [runtime, generate] of [["workspace", geminiWorkspaceArtifact], ["workspace-gemma", gemmaWorkspaceArtifact]]) {
    for (const language of ["en", "ar"]) {
      const artifact = generate({
        profile: "executive_summary",
        language,
        title: language === "ar" ? "إطلاق دورة" : "Course launch",
        brief: language === "ar" ? "حملة إطلاق لدورة رقمية." : "A launch campaign for the course.",
        dialect: "msa",
        shared_context: steps,
      }, null, 0);

      assert.equal(artifact.kind, "deterministic_summary");
      assert.doesNotMatch(artifact.document, new RegExp(taskId, "i"), `${runtime}/${language} leaked a task id`);
      assert.doesNotMatch(artifact.document, new RegExp(SECOND_TASK_ID, "i"), `${runtime}/${language} leaked a task id`);
      assert.doesNotMatch(artifact.document, /Task reference|مرجع المهمة/, `${runtime}/${language} leaked a task-reference label`);
      assert.match(artifact.document, /Social Media Strategist/);
      assert.match(artifact.document, /Content Creator/);
      // The stored summary is already clean, so the render-time redactor is a
      // no-op rather than the only thing hiding the identifier.
      assert.equal(redactTaskReferences(artifact.document), artifact.document.trim());
    }
  }
});

// ---------------------------------------------------------------------------
// §2 — executing tests for the other helpers changed in this round
// ---------------------------------------------------------------------------

test("Item 2: uniqueBlockerConditions collapses the 11 platform-setup codes to one condition", () => {
  const platformCodes = [
    "workflow_not_imported", "workflow_inactive", "polling_disabled", "activation_enables_polling",
    "role_runtime_missing", "runtime_not_enabled", "credential_vault_not_ready",
    "worker_authentication_not_ready", "gateway_not_ready", "postiz_emergency_stop",
    "ghl_platform_emergency_stop",
  ];
  const blocker = (code) => ({ code, severity: "blocking", title: `${code} title`, detail: `${code} detail`, next_action: `${code} next` });
  const all = [...platformCodes, "postiz_connection_not_ready", "content_job_reconciliation_required"].map(blocker);

  for (const ar of [false, true]) {
    const unique = uniqueBlockerConditions(all, ar);
    assert.equal(unique.length, 3, "11 shared codes + 2 distinct conditions");
    const titles = unique.map((item) => customerBlockerCopy(item, ar).title);
    assert.equal(new Set(titles).size, titles.length, "no repeated title is rendered");
    assert.equal(titles[0], customerBlockerCopy(blocker(platformCodes[0]), ar).title);
  }

  // Distinct codes that share customer copy collapse, not the distinct ones.
  assert.equal(uniqueBlockerConditions(all.map(blocker).slice(0, 11), false).length, 1);
  assert.equal(uniqueBlockerConditions([], false).length, 0);

  const agents = read("apps/dashboard/components/agents-workspace.tsx");
  assert.match(agents, /const conditions = uniqueBlockerConditions\(role\.blockers, ar\)/);
  assert.match(agents, /aria-controls={`\$\{role\.code}-blockers-list`}/);
  assert.match(agents, /<BlockerList blockers={visibleConditions} ar={ar} id={`\$\{role\.code}-blockers-list`} \/>/);
});

test("Item 3: the authorize-URL guard refuses literal undefined/null and empty client ids", () => {
  const refused = (url) => {
    try {
      validateAuthorizeUrl(url);
      return null;
    } catch (error) {
      return error;
    }
  };

  for (const url of [
    "https://provider.example/oauth/authorize?client_id=undefined",
    "https://provider.example/oauth/authorize?client_id=null",
    "https://provider.example/oauth/authorize?client_id=",
    "https://provider.example/oauth/authorize?client_id=%20",
    "https://provider.example/oauth/authorize?client_key=undefined&client_id=abc",
  ]) {
    const error = refused(url);
    assert.ok(error instanceof AuthorizeUrlError, `${url} must be refused`);
    assert.equal(error.code, "social_provider_not_configured");
    assert.equal(error.status, 409);
  }

  for (const url of ["", "   ", null, undefined, 42]) {
    const error = refused(url);
    assert.ok(error instanceof AuthorizeUrlError);
    assert.equal(error.code, "social_provider_not_configured");
    assert.equal(error.status, 409);
  }

  for (const url of [
    "http://provider.example/oauth/authorize?client_id=abc",
    "https://user:secret@provider.example/oauth/authorize?client_id=abc",
    "not-a-url",
  ]) {
    const error = refused(url);
    assert.ok(error instanceof AuthorizeUrlError);
    assert.equal(error.code, "postiz_oauth_url_invalid");
    assert.equal(error.status, 502);
  }

  const accepted = validateAuthorizeUrl("https://provider.example/oauth/authorize?client_id=abc123&state=xyz");
  assert.equal(accepted, "https://provider.example/oauth/authorize?client_id=abc123&state=xyz");

  const tenant = read("apps/dashboard/lib/server/postiz-tenant.ts");
  assert.match(tenant, /return validateAuthorizeUrl\(rawUrl\)/);
  assert.match(tenant, /throw new PostizTenantError\(error\.code, error\.status\)/);
});
