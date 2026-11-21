import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTsModule(path, stubResolver) {
  const requireCjs = createRequire(import.meta.url);
  const ts = requireCjs("typescript");
  const js = ts.transpileModule(read(path), {
    fileName: path.split("/").pop(),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)(stubResolver, mod, mod.exports);
  return mod.exports;
}

function loadMarkdown() {
  return loadTsModule("apps/dashboard/lib/markdown.ts", (id) => {
    throw new Error(`unexpected import: ${id}`);
  });
}

function loadTruncate() {
  return loadTsModule("apps/dashboard/lib/truncate.ts", (id) => {
    throw new Error(`unexpected import: ${id}`);
  });
}

function loadPostCards() {
  return loadTsModule("apps/dashboard/components/workspace-post-cards.tsx", (id) => {
    if (id === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null, Fragment: "Fragment" };
    if (id === "react") return { useRef: () => ({ current: null }), useState: () => [null, () => {}] };
    if (id === "lucide-react") return { Download: () => null, ExternalLink: () => null, Sparkles: () => null };
    if (id === "next/link") return { default: () => null };
    if (id === "@/lib/client/use-locale") return { useLocale: () => ({ locale: "en" }) };
    throw new Error(`unexpected import: ${id}`);
  });
}

const plain = (nodes) => nodes.map((node) => node.value).join("");

test("markdown headings, bold, lists and italics render as structure, not source", () => {
  const { parseMarkdown, parseMarkdownInline } = loadMarkdown();
  const blocks = parseMarkdown([
    "# HomeStff — Campaign Work Pack",
    "",
    "## 1. Week-1 Plan",
    "",
    "* **Audience:** Amman homeowners",
    "* **Positioning:** Affordable refresh",
    "",
    "**Positioning:** Verified pricing only",
    "",
    "***Day 6 (Thursday): launch the carousel***",
    "",
    "### 1. Factual Verification & Mismatches",
  ].join("\n"));

  const headings = blocks.filter((block) => block.type === "heading");
  assert.deepEqual(headings.map((block) => block.level), [1, 2, 3]);
  assert.equal(plain(headings[0].inline), "HomeStff — Campaign Work Pack");

  const list = blocks.find((block) => block.type === "list");
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0][0].type, "strong");
  assert.equal(list.items[0][0].value, "Audience:");
  assert.equal(plain(list.items[0]), "Audience: Amman homeowners");

  const bold = blocks.find((block) => block.type === "paragraph");
  assert.equal(bold.inline[0].type, "strong");
  assert.equal(bold.inline[0].value, "Positioning:");

  const emphasis = blocks.filter((block) => block.type === "paragraph")[1];
  assert.equal(emphasis.inline[0].type, "strong_em");
  assert.equal(emphasis.inline[0].value, "Day 6 (Thursday): launch the carousel");

  // No markdown marker survives into rendered text.
  const rendered = JSON.stringify(blocks);
  for (const marker of ["##", "**", "# "]) {
    assert.ok(!rendered.includes(marker), `raw markdown marker ${marker} leaked into rendered blocks`);
  }

  const arabic = parseMarkdown("### 1. تحليل الجمهور\n\n* **النبرة:** دافئة ومباشرة");
  assert.equal(plain(arabic[0].inline), "1. تحليل الجمهور");
  assert.equal(plain(arabic[1].items[0]), "النبرة: دافئة ومباشرة");
  assert.equal(parseMarkdownInline("[دليل](/knowledge)")[0].type, "link");
  assert.equal(parseMarkdownInline("[bad](javascript:alert(1))")[0].type, "text");
});

test("the three deliverable render sites use the safe formatter and never inject HTML", () => {
  const workspace = read("apps/dashboard/components/agency-workspace.tsx");
  const approvals = read("apps/dashboard/components/approval-workspace.tsx");
  const content = read("apps/dashboard/components/content-library.tsx");
  const formatter = read("apps/dashboard/components/formatted-text.tsx");

  assert.match(workspace, /className="aw-document" dir=\{selected\.language === "ar" \? "rtl" : "ltr"\}/);
  // Round 3 item 17 routes the stored document through the UUID redactor first;
  // it is still the safe formatter that renders it.
  assert.match(workspace, /<FormattedText text=\{(?:step\.result\.document|redactTaskReferences\(step\.result\.document\))\}/);
  // Round 3 item 17 redacts stored task references before every render.
  assert.match(approvals, /<FormattedText text=\{redactTaskReferences\(`\$\{deliverable\.excerpt\}/);
  assert.match(approvals, /Read the full deliverable/);
  assert.match(approvals, /اقرأ المخرج كاملاً/);
  assert.match(content, /<FormattedText text=\{redactTaskReferences\(deliverable\.document\)\} \/>/);
  for (const source of [workspace, approvals, content, formatter]) {
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  }
  // Export stays markdown; the screen only changes how it is displayed.
  assert.match(workspace, /text\/markdown;charset=utf-8/);
});

test("excerpts are cut at a word boundary and never mid-word", () => {
  const { truncateAtWord } = loadTruncate();
  const arabic = "هذه الحزمة على حزمة العمل هذه فقط ولا تنشر أي محتوى خارجي";
  const english = "Transform your bedroom into a peaceful sanctuary with HomeStff's new bedding collections";

  for (const [text, limit] of [[arabic, 20], [english, 40], [english, 10]]) {
    const cut = truncateAtWord(text, limit);
    assert.ok(cut.length <= limit, "excerpt stays within the limit");
    assert.ok(text.startsWith(cut), "excerpt is an exact prefix");
    // The next character in the source is whitespace: no word was split.
    assert.ok(/^[\s,;:.،؛:–—-]?/.test(text.slice(cut.length)) && !/[\u0600-\u06ffA-Za-z0-9]/.test(text[cut.length] || " "), "cut lands on a boundary");
  }
  assert.equal(truncateAtWord("short text", 40), "short text");
  // A single long token still returns something rather than nothing.
  assert.ok(truncateAtWord("x".repeat(80), 40).length === 40);

  const route = read("apps/dashboard/app/api/approvals/route.ts");
  const content = read("apps/dashboard/components/content-library.tsx");
  assert.match(route, /truncateMarkdownAtWord\(entry\.document \|\| "", 320\)/);
  assert.match(route, /document: entry\.document \|\| ""/);
  assert.match(content, /markdownExcerpt\(item\.draft_copy, 280\)/);
});

test("a truncated excerpt never leaves a dangling inline markdown marker", () => {
  const { truncateMarkdownAtWord, balanceInlineMarkdown } = loadTruncate();
  const { parseMarkdown } = loadMarkdown();

  // Every inline node the excerpt renders, as one string.
  function renderedText(source) {
    const nodes = [];
    for (const block of parseMarkdown(source)) {
      if (block.inline) nodes.push(...block.inline);
      if (block.items) for (const item of block.items) nodes.push(...item);
    }
    return nodes.map((node) => node.value).join(" ");
  }

  const english = "**Missing Information (Unconfirmed pricing):** we cannot confirm the bundle price today, so please send the current price list before launch.";
  const arabic = "**الحقائق المؤكدة للمشروع:** تفاصيل الحملة لم تُعتمد بعد، لذلك لا يمكن نشر أي رقم قبل مراجعة المالك.";

  for (const [source, limit] of [[english, 40], [arabic, 20]]) {
    const excerpt = truncateMarkdownAtWord(source, limit);
    assert.ok(excerpt.length <= limit, "excerpt stays within the limit");
    // The cut really happened inside the bold span, which is the live failure.
    assert.ok(source.indexOf("**", 2) > excerpt.length, "the sample cuts inside the opening span");
    assert.doesNotMatch(excerpt, /[*`]|__/u, `dangling marker survived: ${excerpt}`);
    const rendered = renderedText(`${excerpt}…`);
    assert.doesNotMatch(rendered, /[*`]|__/u, `raw markdown leaked into the excerpt: ${rendered}`);
    assert.ok(rendered.startsWith(excerpt), "only the ellipsis is added after the cut");
  }

  // Closed spans are untouched, and every marker kind is cleaned when open.
  assert.equal(truncateMarkdownAtWord("**Verified pricing:** confirmed locally", 200), "**Verified pricing:** confirmed locally");
  assert.equal(balanceInlineMarkdown("text __open"), "text open");
  assert.equal(balanceInlineMarkdown("text `open"), "text open");
  assert.equal(balanceInlineMarkdown("text *open"), "text open");
  assert.equal(balanceInlineMarkdown("***Day 6 (Thursday): launch"), "Day 6 (Thursday): launch");

  // Bullet markers must not pair with a dangling ** opener, and an empty
  // trailing bullet left at the word-boundary cut is dropped cleanly.
  const arBullet = "## 1. القسم\n\n* **الحقائق المؤكدة للمشروع:** تفاصيل إضافية";
  const arBulletExcerpt = truncateMarkdownAtWord(arBullet, 30);
  const arBulletRendered = renderedText(`${arBulletExcerpt}…`);
  assert.doesNotMatch(arBulletRendered, /[*`]|__/u, `bullet + bold leaked: ${arBulletRendered}`);

  const enBullet = "*   **Missing Information (Unconfirmed pricing):** details";
  const enBulletExcerpt = truncateMarkdownAtWord(enBullet, 38);
  const enBulletRendered = renderedText(`${enBulletExcerpt}…`);
  assert.doesNotMatch(enBulletRendered, /[*`]|__/u, `indented bullet + bold leaked: ${enBulletRendered}`);

  const bareBulletCut = "First line of copy.\n*   **Second:** body";
  const bareBulletExcerpt = truncateMarkdownAtWord(bareBulletCut, 22);
  assert.equal(bareBulletExcerpt, "First line of copy.");
  assert.doesNotMatch(renderedText(`${bareBulletExcerpt}…`), /[*`]|__/u);
});

test("SVG card text keeps the word boundary when read or copied", () => {
  const cards = loadPostCards();
  const doc = "Transform your bedroom into a peaceful sanctuary with HomeStff's new bedding collections! "
    + "Explore our kitchen tools and smart kitchen solutions, then upgrade your sleep experience.";

  const phrases = [
    "peaceful sanctuary",
    "bedding collections",
    "your sleep",
    "our kitchen tools",
    "kitchen solutions",
  ];

  for (const phrase of phrases) {
    const lines = cards.wrapCardText(doc, 22);
    assert.ok(lines.length > 1, "the sample text wraps");
    const extracted = cards.svgTextRuns(lines).join("");
    assert.ok(extracted.includes(phrase), `extracted card text is missing "${phrase}"`);
  }

  // Every wrapped line keeps its separating space except the last one.
  const runs = cards.svgTextRuns(["a b", "c d", "e"]);
  assert.deepEqual(runs, ["a b ", "c d ", "e"]);

  const source = read("apps/dashboard/components/workspace-post-cards.tsx");
  assert.equal((source.match(/\n\s+xmlSpace="preserve"/g) || []).length, 3);
  assert.equal((source.match(/svgTextRuns\((headline|body|cta)Lines\)/g) || []).length, 3);
  assert.match(source, /SVG concatenates adjacent <tspan>/);
});

test("onboarding step 3 lists the saved knowledge that step 4 counts", () => {
  const step = read("apps/dashboard/components/onboarding-knowledge-step.tsx");
  const wizard = read("apps/dashboard/components/onboarding-wizard.tsx");
  const copy = read("apps/dashboard/lib/i18n/onboarding.ts");

  assert.match(step, /versions\?: Array<Record<string, unknown>>/);
  assert.match(step, /const seen = new Set<string>\(\)/);
  assert.match(step, /drafts\.map\(\(draft\) =>/);
  assert.match(step, /copy\.knowledgeSavedListTitle/);
  assert.match(step, /href="\/knowledge"/);
  // The saved-state notice stays truthful: it is driven by counts.sources, not
  // by whether the "add another draft" box is empty.
  assert.match(step, /payload\.counts\?\.sources \?\? latest\.length/);

  assert.match(wizard, /const firstIncomplete = saved\.findIndex/);
  assert.match(wizard, /setStep\(\(current\) => \(current === 1 \? openingStep : current\)\)/);
  assert.match(wizard, /function stepSaved\(id: Step\)/);
  assert.match(copy, /knowledgeSavedListTitle: "Saved knowledge in your catalogue"/);
  assert.match(copy, /knowledgeSavedListTitle: "المعرفة المحفوظة في دليلك"/);
});

test("agent actions shows audit history and no unexplained internal acronym", () => {
  const page = read("apps/dashboard/components/ghl-action-review.tsx");
  assert.match(page, /import \{ LiveActivity \} from "\.\/live-activity"/);
  assert.match(page, /Agent action history/);
  assert.match(page, /<LiveActivity \/>/);
  assert.doesNotMatch(page, /\bGHL\b|GoHighLevel/);
  assert.match(page, /Actions prepared in your CRM stay bounded by organization policy/);
  // The queue keeps its guards and never retries an uncertain action.
  assert.match(page, /Do not retry/);
  assert.match(page, /confirmed_not_applied/);
  assert.match(page, /confirmed_succeeded/);
});
