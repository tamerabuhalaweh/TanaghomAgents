import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
  assert.match(msa, /strict plural-polite, gender-neutral Arabic/);
  assert.match(msa, /صيغة الجمع المحايدة المخاطبة للجميع/);
  assert.match(msa, /مرحباً بكم في…/);
  assert.match(msa, /هل تبحثون عن…؟/);
  assert.match(msa, /never write مرحباً بك, مرحباً بكِ, هل تعبت, هل تبحث/);
  assert.match(msa, /يوفر متجرنا/);
  assert.match(msa, /never the feminine «توفر متجرنا»/);
  assert.match(msa, /بكِ/);
  assert.match(msa, /تحتاجينه/);
  assert.match(msa, /بطقس ذكي/);
  assert.match(msa, /ألولايات/);
  assert.match(msa, /مرحلاً/);
  // A local dialect keeps headings in White Arabic and customer copy in that dialect.
  assert.match(system({ dialect: "levant" }), /Levantine Arabic[\s\S]{0,120}never slip into a second dialect/);
  // Hashtags are mandatory for content drafts only.
  assert.match(system({ profile: "content_creator" }), /3 to 5 relevant hashtags/);
  assert.match(system({ profile: "content_creator" }), /Do not open the content draft pack with a "Missing Information Notice" section/);
  assert.match(system({ profile: "content_creator" }), /start directly with ## Post 1, ## Post 2 and ## Post 3/);
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
  assert.match(review, /masculine-singular, NOT gender-neutral/);
  assert.match(review, /Grammatical & Register Corrections \/ تصحيحات نحوية وأسلوبية/);
  assert.match(review, /NEVER as factual mismatches/);
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
  assert.match(cards, /const CTA_HEADING = \/call to action\|نداء الإجراء\|دعوة للتفاعل\|دعوة لاتخاذ إجراء\|دعوة إلى اتخاذ إجراء\/iu;/);
  assert.match(cards, /function segmentedCard\(body: string\[\], fallbackCta: string\)/);
  assert.match(cards, /function splitHeadline\(text: string\)/);
  assert.match(cards, /matching\.find\(\(field\) => \/english\|en\\b\/u\.test\(field\.qualifier\)/);
  assert.match(cards, /if \(NON_POST_BLOCK\.test\(block\)\) continue;/);
  assert.match(cards, /const STRUCTURAL_PREFIX = \/\^\(\?:opening\|headline\|hook\|body\|caption\|cta/);
  assert.match(cards, /export function stripStructuralPrefix/);
  assert.match(cards, /export function completeText/);
  assert.match(cards, /const headlineSize = card\.headline\.length > 120 \? 34/);
  assert.match(cards, /const bodyLines = fitLines\(card\.body, bodyPerLine, maxBodyLines\)/);
  // The CTA badge wraps the full call to action, never a hard slice.
  assert.match(cards, /const ctaLines = card\.cta \? fitLines\(card\.cta, ctaPerLine, 3\) : \[\]/);
  assert.doesNotMatch(cards, /card\.cta\.slice\(/);
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
  assert.match(out.document, /Work pack total AI units \(Tasks 1–5\): 500/);
  assert.match(out.document, /Work pack total generation time \(Tasks 1–5\): 5\.0s/);
  assert.match(out.document, /Step 6 cost \(deterministic executive summary\): 0 units · 0\.0s/);
  assert.deepEqual(out.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 500 });
  assert.equal(out.elapsed_ms, 5000);
  assert.equal(out.kind, "deterministic_summary");
  const arabic = workspaceArtifact({ ...report, language: "ar" }, null, 0);
  assert.match(arabic.document, /المخرجات المحفوظة: 6 من 6 \(5 مخرجات متخصصة \+ هذا الملخص التنفيذي\)/);
  assert.match(arabic.document, /إجمالي وحدات الحزمة \(المهام 1–5\): 500/);
  assert.match(arabic.document, /تكلفة الخطوة 6 \(الملخص التنفيذي الحتمي\): 0 وحدة · 0\.0 ثانية/);
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

// Loads the pure card extractor out of the client component: transpile the
// TSX, then satisfy its UI imports with inert stubs.
function loadPostCards() {
  const requireCjs = createRequire(import.meta.url);
  const ts = requireCjs("typescript");
  const source = read("apps/dashboard/components/workspace-post-cards.tsx");
  const js = ts.transpileModule(source, {
    fileName: "workspace-post-cards.tsx",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const stub = (id) => {
    if (id === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null, Fragment: "Fragment" };
    if (id === "react") return { useRef: () => ({ current: null }), useState: () => [null, () => {}] };
    if (id === "lucide-react") return { Download: () => null, ExternalLink: () => null, Sparkles: () => null };
    if (id === "next/link") return { default: () => null };
    if (id === "@/lib/client/use-locale") return { useLocale: () => ({ locale: "en" }) };
    throw new Error(`unexpected import: ${id}`);
  };
  new Function("require", "module", "exports", js)(stub, module, module.exports);
  return module.exports;
}

test("Packet J: three cards from the Post 1/2/3 draft, full copy and no hashtags in the CTA", () => {
  const first = "Welcome to HomeStff (أشياء بيتي), your new online destination for home goods in Jordan!";
  const third = "From kitchen tools to decor, discover the home essentials that make everyday living in Amman calmer and easier";
  const draft = [
    "# HomeStff Instagram Post Drafts (Amman Launch)",
    "",
    "## Post 1: Welcome to HomeStff",
    `* **Opening:** ${first}`,
    "* **Body:** Discover a curated range of kitchen tools, storage and decor, delivered across Jordan with cash on delivery.",
    "* **Call to Action:** Order your home essentials today and pay when they arrive at your door!",
    "* **Hashtags:** #HomeStff #أشياء_بيتي #HomeGoods #Jordan",
    "",
    "## Post 2: Why HomeStff",
    "* **Opening:** Who are you letting into your home?",
    "* **Body:** Peace of mind starts with knowing who is working on your space, so every provider is vetted before the first visit.",
    "* **Call to Action:** Send us a message to get started.",
    "* **Hashtags:** #HomeStff #TrustedHomes",
    "",
    "## Post 3: Everyday essentials",
    `* **Opening:** ${third}`,
    "* **Body:** Browse the catalogue, choose what your home needs and pay in cash when the order reaches your door.",
    "* **Call to Action:** Start your home essentials order today!",
    "* **Hashtags:** #HomeEssentials #Jordan",
  ].join("\n");
  const { socialPostCards } = loadPostCards();
  const cards = socialPostCards(draft, null);
  assert.equal(cards.length, 3);
  assert.equal(cards[0].headline, first);
  assert.equal(cards[0].cta, "Order your home essentials today and pay when they arrive at your door!");
  assert.equal(cards[2].headline, third);
  assert.ok(cards[0].hashtags.includes("#HomeStff"));
  for (const card of cards) {
    assert.doesNotMatch(card.cta, /#/);
    assert.doesNotMatch(card.cta, /hashtag/i);
    assert.doesNotMatch(card.headline, /^(?:opening|body|call to action|hashtags)\b/i);
  }
});

test("Packet J: Arabic labels on their own line still yield clean card copy", () => {
  const draft = [
    "# مسودات منشورات إنستغرام",
    "",
    "## Post 1",
    "**الافتتاحية (Hook):**",
    "هل ترغبون في تجهيز منزلكم في عمّان؟",
    "**المحتوى (Body):**",
    "يقدّم متجرنا تشكيلة مختارة من أدوات المطبخ والديكور مع التوصيل والدفع عند الاستلام.",
    "**دعوة لاتخاذ إجراء (CTA):**",
    "اطلبوا احتياجاتكم اليوم واحصلوا على توصيل مجاني.",
    "**الهاشتاقات:**",
    "#أشياء_بيتي #عمّان #أدوات_منزلية",
  ].join("\n");
  const { socialPostCards } = loadPostCards();
  const [card] = socialPostCards(draft, null);
  assert.equal(card.headline, "هل ترغبون في تجهيز منزلكم في عمّان؟");
  assert.match(card.body, /يقدّم متجرنا/);
  assert.equal(card.cta, "اطلبوا احتياجاتكم اليوم واحصلوا على توصيل مجاني.");
  assert.doesNotMatch(card.headline, /الافتتاحية|\*\*/);
  assert.match(card.hashtags, /#أشياء_بيتي/);
});

 test("Packet J: one approved label, two-step change request, MSA default and Task 6 cost", () => {
  const view = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(view, /approved: "Approved"/);
  assert.match(view, /approved: "معتمدة"/);
  assert.match(view, /معتمدة ضمن الحزمة/);
  assert.match(view, /Approved in pack/);
  assert.match(view, /step\.profile_code === "content_creator" \? <WorkspacePostCards/);
  assert.match(view, /const \[confirmingReject, setConfirmingReject\] = useState\(false\)/);
  assert.match(view, /setConfirmingReject\(true\); \}\}/);
  assert.match(view, /setConfirmingReject\(false\); void command\(\{ action: "reject"/);
  assert.equal(view.match(/action: "reject"/g).length, 1);
  assert.match(view, /هل تريد تأكيد إرسال طلب التعديل/);
  assert.match(view, /Confirm sending this change request and marking the work pack as “Changes requested”\?/);
  assert.match(view, /تأكيد طلب التعديل/);
  assert.match(view, /Confirm change request/);
  assert.match(view, /لإجراء تعديلات بعد قرار نهائي، اضغط «موجز حملة جديد»/);
  assert.match(view, /To make further edits after a final decision, click “New campaign brief”/);
  assert.match(view, /0 units · 0\.0s for this step · Pack total \(Tasks 1–5\): /);
  assert.match(view, /0 وحدة · 0\.0 ثانية لهذه الخطوة · إجمالي الحزمة \(المهام 1–5\): /);
  assert.match(view, /setDialect\(nextLanguage === "en" \? "msa" : data\?\.default_dialect \?\? "msa"\)/);
  assert.match(view, /setDialect\(kind === "en" \? "msa" : data\?\.default_dialect \?\? "msa"\)/);
  assert.match(view, /Modern Standard Arabic \(White Arabic\) is the default for English and bilingual briefs/);
});

test("no new SQL migration was added for Packet I", () => {
  const migrations = readdirSync(new URL("../packages/database/migrations", import.meta.url)).filter((name) => name.endsWith(".up.sql"));
  assert.equal(migrations.filter((name) => /^005[4-9]_/.test(name)).length, 0);
});
