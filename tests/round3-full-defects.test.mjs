import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Round 3 item 1: the supervisor inbox body is bilingual, not English-only", async () => {
  const inbox = await read("apps/dashboard/components/supervisor-inbox.tsx");
  assert.match(inbox, /import \{ useLocale \} from "@\/lib\/client\/use-locale"/);
  assert.match(inbox, /const ar = locale === "ar"/);
  // Page shell, counters, filters, empty states and actions all carry Arabic.
  assert.match(inbox, /title=\{ar \? "صندوق المشرف" : "Supervisor inbox"\}/);
  assert.match(inbox, /ar \? "تحديث" : "Refresh"/);
  assert.match(inbox, /ar \? "ابحث بالاسم أو الحملة أو النية" : "Search name, campaign, intent"/);
  assert.match(inbox, /ar \? "لا توجد محادثات مطابقة" : "No conversations match"/);
  assert.match(inbox, /ar \? "اختر محادثة" : "Select a conversation"/);
  assert.match(inbox, /ar \? "ملخص التسليم" : "Handoff brief"/);
  assert.match(inbox, /ar \? "الخط الزمني للمحادثة" : "Conversation timeline"/);
  // State labels are translated instead of a single English record.
  assert.match(inbox, /human_required: \{ en: "Human required", ar: "تحتاج تدخل بشري" \}/);
  assert.match(inbox, /stateLabels\[conversation\.state\]\[ar \? "ar" : "en"\]/);
  // The protected behaviour from PR #339 is untouched.
  assert.match(inbox, /const awaitingActivation = emergencyStopped/);
});

test("Round 3 item 2: 'Show all' swaps one full list in, and duplicate copy collapses", async () => {
  const agents = await read("apps/dashboard/components/agents-workspace.tsx");
  // One list at a time: no <details> that renders a second BlockerList on top of the preview.
  assert.doesNotMatch(agents, /<details>\s*<summary>\{ar \? `عرض كل الشروط/);
  assert.doesNotMatch(agents, /compact = false/);
  assert.equal((agents.match(/<BlockerList /g) || []).length, 1);
  assert.match(agents, /const \[showAllConditions, setShowAllConditions\] = useState\(false\)/);
  assert.match(agents, /const visibleConditions = showAllConditions \? conditions : conditions\.slice\(0, 3\)/);
  assert.match(agents, /aria-expanded=\{showAllConditions\}/);
  // The duplicate visible condition is removed before the count is rendered;
  // tests/round3-blockers.test.mjs executes that de-duplication directly.
  assert.match(agents, /const conditions = uniqueBlockerConditions\(role\.blockers, ar\)/);
  assert.match(agents, /<span>\{conditions\.length\}<\/span>/);
});

test("Round 3 item 3: an authorize URL with a literal undefined client id is refused", async () => {
  const tenant = await read("apps/dashboard/lib/server/postiz-tenant.ts");
  assert.match(tenant, /return validateAuthorizeUrl\(rawUrl\)/);
  // tests/round3-blockers.test.mjs executes the guard on undefined/null/empty ids.
  const guard = await read("apps/dashboard/lib/oauth-authorize-url.ts");
  assert.match(guard, /throw new AuthorizeUrlError\("social_provider_not_configured", 409\)/);
  // The UI already turns that code into a clear message instead of navigating.
  const channels = await read("apps/dashboard/components/channels-settings.tsx");
  assert.match(channels, /response\.status === 409 && body\.error === "social_provider_not_configured"/);
  assert.match(channels, /setNotice\(text\.providerMissing\)/);
});

test("Round 3 item 4: Export pack downloads from an attached anchor, without ids or hashes", async () => {
  const workspace = await read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(workspace, /document\.body\.appendChild\(a\);\r?\n\s*a\.click\(\);\r?\n\s*a\.remove\(\);/);
  assert.match(workspace, /a\.download = `e3lani-workpack-\$\{selected\.id\}\.md`/);
  assert.match(workspace, /setNotice\(ar \? "جارٍ تصدير الحزمة كملف Markdown\." : "Exporting the pack as a Markdown file\."\)/);
  // The exported markdown no longer embeds task UUIDs or response hashes.
  assert.doesNotMatch(workspace, /Task: \$\{s\.task_id\}/);
  assert.doesNotMatch(workspace, /Version: \$\{s\.response_hash\}/);
  assert.doesNotMatch(workspace, /المهمة: \$\{s\.task_id\}/);
  assert.doesNotMatch(workspace, /الإصدار: \$\{s\.response_hash\}/);
  assert.equal((workspace.match(/\$\{redactTaskReferences\(s\.result!\.document\)\}/g) || []).length, 2);
});

test("Round 3 item 5: overview campaign rows link to their own campaign", async () => {
  const overview = await read("apps/dashboard/components/overview-dashboard.tsx");
  assert.match(
    overview,
    /<Link href=\{campaign\.source === "ai_workspace" \? `\/workspace\?id=\$\{campaign\.id\}` : `\/campaigns\/\$\{campaign\.id\}`\}>\{campaign\.name\}<\/Link>/,
  );
  assert.doesNotMatch(overview, /<Link href="\/campaigns">\{campaign\.name\}<\/Link>/);
  // Same destination as the "Open work pack" button on /campaigns.
  const campaigns = await read("apps/dashboard/components/campaigns-view.tsx");
  assert.match(campaigns, /campaign\.source === "ai_workspace" \? `\/workspace\?id=\$\{campaign\.id\}` : `\/campaigns\/\$\{campaign\.id\}`/);
});

test("Round 3 item 6: every template can be viewed and edited from the list", async () => {
  const templates = await read("apps/dashboard/components/creative/templates-view.tsx");
  assert.match(templates, /const \[editing, setEditing\] = useState<string \| null>\(null\)/);
  assert.match(templates, /const \[viewing, setViewing\] = useState<string \| null>\(null\)/);
  assert.match(templates, /function startEditing\(template: TemplateRow\)/);
  assert.match(templates, /setHeadline\(specText\(template\.spec, "headline"\)\)/);
  assert.match(templates, /t\(locale, "templates\.view"\)/);
  assert.match(templates, /t\(locale, "templates\.edit"\)/);
  assert.match(templates, /<section className="creative-card-detail"/);
  // The list response has to carry the stored spec for a prefilled edit.
  const store = await read("apps/dashboard/lib/server/creative/templates.ts");
  assert.match(store, /SELECT id AS template_id, organization_id, kind, name, version, is_active, created_at, spec/);
});

test("Round 3 item 7: dead legacy routes redirect instead of 404", async () => {
  const config = await read("apps/dashboard/next.config.ts");
  assert.match(config, /source: "\/billing", destination: "\/settings\/billing"/);
  assert.match(config, /source: "\/sessions", destination: "\/settings\/security"/);
  assert.match(config, /source: "\/packs", destination: "\/campaigns"/);
  assert.match(config, /source: "\/packs\/:id", destination: "\/workspace\?id=:id"/);
});

test("Round 3 item 9: tall previews scale instead of being capped at 34rem", async () => {
  const css = await read("apps/dashboard/app/creative.css");
  assert.doesNotMatch(css, /max-block-size: 34rem/);
  const preview = await read("apps/dashboard/components/creative/scaled-preview.tsx");
  assert.match(preview, /blockSize: scale > 0 \? `\$\{Math\.round\(height \* scale\)\}px` : undefined/);
  for (const editor of ["design-editor-view.tsx", "motion-editor-view.tsx"]) {
    const source = await read(`apps/dashboard/components/creative/${editor}`);
    assert.match(source, /<ScaledPreview/);
  }
  // The "Text" label sits above its textarea rather than over its border.
  assert.match(css, /\.creative-card label \{\r?\n\s*display: grid;/);
});

test("Round 3 item 17: stored task-reference UUIDs are redacted at render time only", async () => {
  const workspace = await read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(workspace, /import \{ redactTaskReferences \} from "@\/lib\/redact-task-references"/);
  const redactor = await read("apps/dashboard/lib/redact-task-references.ts");
  assert.match(redactor, /export function redactTaskReferences\(document: string\): string/);
  assert.match(redactor, /Task reference\|مرجع المهمة/);
  assert.match(redactor, /const BARE_NUMBERED_LINE = \/\^\\d\+\\\.\\s\*\$\/;/);
  assert.match(workspace, /<FormattedText text=\{redactTaskReferences\(step\.result\.document\)\}/);
  // The API payload and the footer label are deliberately untouched.
  assert.match(workspace, /"Executive delivery summary"/);
  assert.match(workspace, /"ملخص التسليم التنفيذي"/);
});
