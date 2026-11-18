import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { workspaceRequest, workspaceArtifact } from "../packages/agent-runtime/workspace.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const task = {
  profile: "social_media_strategist",
  language: "ar",
  dialect: "msa",
  model: "gemini-3.5-flash-lite",
  title: "حملة فيلا ذكية",
  brief: "أعدّ منشورات إنستغرام عضوية لمشروع فيلا في عمّان، بنبرة راقية.",
  source_facts: "ثلاث غرف نوم، مساحة 320 متراً، تسليم بعد 18 شهراً، ولا يوجد ضمان استثماري.",
  shared_context: [],
  context_hash: `sha256:${"1".repeat(64)}`,
};
const system = (overrides = {}) => workspaceRequest({ ...task, ...overrides }, 32768).systemInstruction.parts[0].text;

test("1: Arabic register, gender-neutral addressing and lexical bans are enforced in the prompt", () => {
  const msa = system();
  assert.match(msa, /White Arabic/);
  assert.match(msa, /zero colloquial words/);
  assert.match(msa, /مش, بتوفّر, خلّي, تخلي, بتدفع or لازم/);
  assert.match(msa, /gender-neutral inclusive Arabic/);
  assert.match(msa, /بكِ/);
  assert.match(msa, /تحتاجينه/);
  assert.match(msa, /بطقس ذكي/);
  assert.match(msa, /ألولايات/);
  assert.match(msa, /مرحلاً/);
  // A local dialect keeps headings in White Arabic and customer copy in that dialect.
  assert.match(system({ dialect: "levant" }), /Levantine Arabic[\s\S]{0,120}never slip into a second dialect/);
  // Hashtags are mandatory for content drafts only.
  assert.match(system({ profile: "content_creator" }), /3 to 5 relevant hashtags/);
  assert.doesNotMatch(system({ profile: "discovery_coach" }), /3 to 5 relevant hashtags/);
  // English-only briefs stay free of Arabic style rules.
  assert.doesNotMatch(system({ language: "en", dialect: undefined, brief: "Write organic Instagram posts." }), /White Arabic|اللهجة/);
});

test("1: bilingual support answers cover all five pairs in both languages", () => {
  const bilingual = system({
    profile: "support_responder",
    brief: "أعد ردود الدعم وأسئلة التأهيل بالعربية والإنجليزية (bilingual).",
  });
  assert.match(bilingual, /ALL five Q&A pairs/);
  assert.match(bilingual, /BOTH English and Arabic/);
  assert.doesNotMatch(system({ profile: "support_responder" }), /ALL five Q&A pairs/);
});

test("1: the workspace logs the resolved dialect for Arabic, explicit and bilingual briefs", () => {
  const server = read("apps/dashboard/lib/server/agency-workspace.ts");
  assert.match(server, /if\(body\.language==="ar"\|\|body\.dialect!==undefined\|\|bilingualRequested\(\{brief:String\(body\.brief\),source_facts:String\(body\.source_facts\)\}\)\)/);
  assert.match(server, /if\(task\.language==="ar"\|\|bilingualRequested\(task\)\)\{/);
  assert.match(server, /resolveArabicDialect\(\{campaignDialect:context\?\.brief_dialect,brandKitDialect:context\?\.brand_dialect,location:context\?\.location\}\)/);
});

test("2: brand guardian audits claims, Arabic spelling and the resolved dialect, then gives one verdict", () => {
  const review = system({ profile: "brand_guardian", dialect: "gulf" });
  assert.match(review, /Task 1, including Arabic pillar names and headings/);
  assert.match(review, /openings, bodies, CTAs and hashtags/);
  assert.match(review, /Gulf Arabic \(Khaleeji\)/);
  assert.match(review, /اللهجة الخليجية/);
  assert.match(review, /Never claim the brief mandated Modern Standard Arabic/);
  assert.match(review, /exactly ONE review status line/);
  assert.match(review, /Review Status: Ready for Human Review after applying the corrections above/);
  assert.match(review, /حالة المراجعة: لا توجد تعديلات مطلوبة — جاهز للمراجعة البشرية/);
  assert.match(review, /Never write "APPROVED for use"/);
  assert.doesNotMatch(system({ profile: "content_creator" }), /exactly ONE review status line/);
});

test("3: the content API returns the untruncated pack plus a deliverables array", () => {
  const route = read("apps/dashboard/app/api/content/route.ts");
  assert.doesNotMatch(route, /left\(coalesce\(documents\.document/);
  assert.match(route, /string_agg\('## ' \|\| step\.sequence \|\| '\. '/);
  assert.match(route, /jsonb_agg\(jsonb_build_object\('sequence', step\.sequence/);
  assert.match(route, /'profile_code', step\.profile_code/);
  assert.match(route, /'document', task\.result->>'document'/);
  assert.match(route, /coalesce\(documents\.document,workspace\.brief\) AS draft_copy,documents\.deliverables,/);
  const view = read("apps/dashboard/components/content-library.tsx");
  assert.match(view, /item\.draft_copy\.length > 280/);
  assert.match(view, /deliverables\.map\(\(deliverable\) => <section key=\{deliverable\.sequence\}>/);
  assert.match(view, /href=\{`\/workspace\?id=\$\{item\.id\}`\}/);
  assert.match(view, /untruncated\./);
});

test("4 and 8: workspace state follows the command and the selected id, with live step progress", () => {
  const view = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(view, /const selectedIdRef = useRef<string \| null>\(null\)/);
  assert.match(view, /selectedIdRef\.current = selectedId \?\? data\?\.selected\?\.id \?\? null/);
  assert.match(view, /const suspended = useRef\(false\)/);
  assert.match(view, /if \(!document\.hidden && !suspended\.current\) void load\(selectedIdRef\.current, true\)/);
  assert.match(view, /const optimisticStatus: Record<string, string> = \{ approve: "approved", reject: "rejected", pause: "paused", resume: "queued", cancel: "cancelled", start: "queued", retry: "queued" \}/);
  assert.match(view, /if \(nextStatus && settled\) applyStatus\(settled, nextStatus\)/);
  assert.match(view, /selected: current\.selected\?\.id === id \? \{ \.\.\.current\.selected, status \} : current\.selected/);
  // Creation switches the pane and inserts the row before the refetch.
  assert.match(view, /selectedIdRef\.current = created;\s*\n\s*setSelectedId\(created\); setCreating\(false\)/);
  assert.match(view, /assignments: \[\{ id: created, title, language: createdLanguage/);
  // 2s polling while queued or running, with a named live step.
  assert.match(view, /\}, 2000\);/);
  assert.match(view, /"queued", "running"\]\.includes\(selected\.status\)/);
  assert.match(view, /جارٍ التنفيذ الآن — الخطوة/);
  assert.match(view, /In progress — Step/);
  assert.match(view, /const liveSeconds = Math\.max\(5, liveRemaining \* 5\)/);
});

test("5: post cards skip missing-information notices, strip labels and hand off real copy", () => {
  const cards = read("apps/dashboard/components/workspace-post-cards.tsx");
  assert.match(cards, /const NON_POST_BLOCK = \/missing information\|missing decisions\|open items/);
  assert.match(cards, /قرارات ناقصة\|بنود مفتوحة/);
  assert.match(cards, /english copy\|arabic copy\|english version/);
  assert.match(cards, /const NON_POST_HEADLINE = \/\^\(\?:visual\|photo\|image\)/);
  assert.match(cards, /const FIELD_LINE = \/\^\\s\*\[\*\\-•\]/);
  assert.match(cards, /const POST_SECTION = \/\^\\s\*#\{1,4\}\\s\*.*\(\?:post\|منشور\)/);
  assert.match(cards, /function labelledCard\(section: string, fallbackCta: string\)/);
  assert.match(cards, /const LANGUAGE_LABEL = \/\^\\s\*\[\*\\-•\]\?\\s\*\\\*\{0,2\}/);
  assert.match(cards, /const COPY_HEADING = \/\^#\{3,6\}\\s\*\(\?:post copy\|copy/);
  assert.match(cards, /const CTA_HEADING = \/call to action\|نداء الإجراء\|دعوة للتفاعل\/iu;/);
  assert.match(cards, /function segmentedCard\(body: string\[\], fallbackCta: string\)/);
  assert.match(cards, /function splitHeadline\(text: string\)/);
  assert.match(cards, /matching\.find\(\(field\) => \/english\|en\\b\/u\.test\(field\.qualifier\)/);
  assert.match(cards, /if \(NON_POST_BLOCK\.test\(block\)\) continue;/);
  assert.match(cards, /const STRUCTURAL_PREFIX = \/\^\(\?:opening\|headline\|hook\|body\|caption\|cta/);
  assert.match(cards, /export function stripStructuralPrefix/);
  assert.match(cards, /export function completeText/);
  assert.match(cards, /const headlineSize = card\.headline\.length > 64 \? 42/);
  assert.match(cards, /const bodyLines = fitLines\(card\.body, bodyPerLine, maxBodyLines\)/);
  assert.match(cards, /from: "workspace", title: card\.headline, headline: card\.headline, body: card\.body, cta: card\.cta, lang: language/);
  assert.match(cards, /افتح البطاقة في استوديو التصاميم/);
  const studio = read("apps/dashboard/components/creative/designs-view.tsx");
  assert.match(studio, /if \(params\.get\("from"\) !== "workspace"\) return;/);
  assert.match(studio, /const \[imported, setImported\] = useState<ImportedCard \| null>\(null\)/);
  assert.match(studio, /blankAdSpec\(designLocale, format\.width, format\.height, imported \?\? undefined\)/);
  assert.match(studio, /className="creative-import-card"/);
  assert.match(studio, /copy\?\.headline\?\.trim\(\) \|\|/);
  const workspace = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(workspace, /ملاحظة حول المرئيات: ينشئ الفريق مسودات المنشورات/);
  assert.match(workspace, /AI photo generation is not enabled\./);
});

test("6 and 10: the language switch is in the mobile header, dialect is always offered, facts have a template", () => {
  const shell = read("apps/dashboard/components/app-shell.tsx");
  assert.match(shell, /<div className="mobile-locale"><LocaleToggle locale=\{locale\} \/><\/div>/);
  const workspace = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(workspace, /Arabic content dialect \(used for Arabic or bilingual output\)/);
  assert.match(workspace, /إدراج قالب حقائق سريعة/);
  assert.match(workspace, /Insert quick facts template/);
  assert.match(workspace, /إعادة المحاولة المستخدمة لهذه الحملة/);
  assert.match(workspace, /كل وحدة تمثل كمية صغيرة من النص المولَّد/);
  assert.match(workspace, /New campaign brief/);
  const overview = read("apps/dashboard/components/overview-dashboard.tsx");
  assert.match(overview, /New campaign brief/);
  assert.match(overview, /موجز حملة جديد/);
});

test("7: request changes explains its rule, stays clickable and focuses the feedback box", () => {
  const view = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(view, /Click “Approve work pack” to accept, or type at least 3 characters of feedback above to enable “Request changes”\./);
  assert.match(view, /للاكتفاء بالنتيجة اضغط «اعتماد حزمة العمل»/);
  assert.match(view, /if \(feedback\.trim\(\)\.length < 3\) \{ setFeedbackHint\(true\); feedbackRef\.current\?\.focus\(\); return; \}/);
  assert.match(view, /<textarea ref=\{feedbackRef\}/);
  assert.doesNotMatch(view, /disabled=\{busy \|\| feedback\.trim\(\)\.length < 3\}/);
});

test("9: the executive summary reports 6 of 6 and carries its own usage without double counting", () => {
  const steps = ["social_media_strategist", "content_creator", "brand_guardian", "discovery_coach", "support_responder"]
    .map((profile, index) => ({ profile, task_id: `task-${index}`, document: `مسودة ${index}`, response_hash: `v${index}`, usage: { total_tokens: 100 }, elapsed_ms: 1000 }));
  const report = { ...task, profile: "executive_summary", language: "en", dialect: "msa", shared_context: steps };
  const out = workspaceArtifact(report, null, 0);
  assert.match(out.document, /Saved deliverables: 6 of 6 \(5 specialist deliverables \+ this executive summary\)/);
  assert.deepEqual(out.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 500 });
  assert.equal(out.elapsed_ms, 5000);
  assert.equal(out.kind, "deterministic_summary");
  const arabic = workspaceArtifact({ ...report, language: "ar" }, null, 0);
  assert.match(arabic.document, /المخرجات المحفوظة: 6 من 6 \(5 مخرجات متخصصة \+ هذا الملخص التنفيذي\)/);
  const quota = read("apps/dashboard/lib/server/workspace-quotas.ts");
  assert.equal(quota.match(/COALESCE\(task\.result->>'kind',''\) <> 'deterministic_summary'/g).length, 2);
  const admin = read("apps/dashboard/lib/server/super-admin.ts");
  assert.equal(admin.match(/COALESCE\(task\.result->>'kind',''\) <> 'deterministic_summary'/g).length, 6);
});

test("11: a test-account password reset can clear the forced password change", () => {
  const admin = read("deployment/dashboard-demo/auth/admin.mjs");
  assert.match(admin, /--no-must-change/);
  assert.match(admin, /const mustChangePassword = options\.noMustChange !== true;/);
  assert.match(admin, /changePassword\(email, password, \{ mustChangePassword \}\)/);
  assert.match(admin, /mustChangePassword,\s*\}\);/);
  const login = read("apps/dashboard/components/login-form.tsx");
  assert.match(login, /window\.location\.assign\(body\.must_change_password \? "\/settings\/security" : "\/"\)/);
});

test("no new SQL migration was added for Packet I", () => {
  const migrations = readdirSync(new URL("../packages/database/migrations", import.meta.url)).filter((name) => name.endsWith(".up.sql"));
  assert.equal(migrations.filter((name) => /^005[4-9]_/.test(name)).length, 0);
});
