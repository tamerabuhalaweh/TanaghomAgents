import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { bilingualRequested, workspaceRequest } from "../packages/agent-runtime/workspace.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTsModule(path, stubResolver) {
  const requireCjs = createRequire(import.meta.url);
  const ts = requireCjs("typescript");
  const source = read(path);
  const js = ts.transpileModule(source, {
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

function loadReviewCorrections() {
  return loadTsModule("apps/dashboard/lib/workspace-review-corrections.ts", (id) => {
    throw new Error(`unexpected import: ${id}`);
  });
}

// Verbatim Task 2 and Task 3 deliverables from live reference pack eb96f916-eb12-4687-9171-2b0fc41e6a93.
const EB96_TASK2 = [
  "## Post 1: Launch Announcement",
  "",
  "**Channel:** Instagram & Facebook",
  "",
  "### English Copy",
  "* **Opening:** Looking to refresh your home without breaking the bank? Meet HomeStff (أشياء بيتي)!",
  "* **Body:** Discover our online collection of kitchen tools, bedding, home decor, and smart home gadgets designed for modern living. We deliver fast right to your doorstep across Jordan, with convenient cash on delivery available. (Note: Specific prices and exact delivery timeframes are currently unconfirmed.)",
  "* **Call to Action:** Shop now at HomeStff!",
  "* **Visual Brief:** A vibrant carousel showing a stylish Amman living room, a cozy bedroom, and a modern kitchen featuring our product categories.",
  "",
  "### Arabic Copy (MSA)",
  "* **Opening:** هل تبحثون عن تجديد منازلكم بطريقة ذكية وبأسعار مناسبة؟ تعرّفوا على متجر \"أشياء بيتي\" (HomeStff)!",
  "* **Body:** اكتشفوا تشكيلتنا المميزة عبر الإنترنت من أدوات المطبخ، والمفارش، وديكورات المنازل، والأجهزة الذكية المصممة لتلبي احتياجاتكم اليومية. يوفّر متجرنا خدمة التوصيل السريع إلى جميع أنحاء الأردن، مع توفر خيار الدفع عند الاستلام. (ملاحظة: الأسعار المحددة ومواعيد التوصيل الدقيقة غير متوفرة حالياً).",
  "* **Call to Action:** تسوّقوا الآن عبر متجر \"أشياء بيتي\"!",
  "* **Hashtags:** #أشياء_بيتي #HomeStff #تجديد_المنزل #ديكور_منزلي #الأردن",
  "",
  "---",
  "",
  "## Post 2: Smart & Practical Living",
  "",
  "**Channel:** Instagram & Facebook",
  "",
  "### English Copy",
  "* **Opening:** Upgrade your daily routine with smart gadgets from HomeStff.",
  "* **Body:** Make cooking and managing your home effortless with our practical kitchen tools and smart home gadgets. We offer affordable prices and fast delivery across Jordan. (Note: Specific product pricing is currently unconfirmed.)",
  "* **Call to Action:** Order your smart gadgets today!",
  "* **Visual Brief:** A short video or reel demonstrating a smart home gadget and a time-saving kitchen tool in an Amman apartment setting.",
  "",
  "### Arabic Copy (MSA)",
  "* **Opening:** طوّروا روتينكم اليومي باستخدام الأجهزة الذكية والأدوات العملية من متجر \"أشياء بيتي\".",
  "* **Body:** اجعلوا الطبخ وإدارة منازلكم أكثر سهولة مع أدوات المطبخ والأجهزة الذكية المتوفرة لديكم. تضمن الأسعار المعقولة والتوصيل السريع إلى جميع أنحاء الأردن حصولكم على الأفضل دائماً. (ملاحظة: أسعار المنتجات المحددة غير متوفرة حالياً).",
  "* **Call to Action:** اطلبوا أجهزتكم الذكية اليوم!",
  "* **Hashtags:** #أجهزة_ذكية #أدوات_مطبخ #HomeStff #أشياء_بيتي #المنزل_الذكي",
  "",
  "---",
  "",
  "## Post 3: Comfort & Aesthetics",
  "",
  "**Channel:** Instagram & Facebook",
  "",
  "### English Copy",
  "* **Opening:** Create the home of your dreams in Amman with HomeStff.",
  "* **Body:** From elegant home decor to cozy bedding, we bring comfort and style straight to your doorstep. Enjoy fast delivery across Jordan and convenient cash on delivery. (Note: Specific catalog items and exact delivery schedules are currently unconfirmed.)",
  "* **Call to Action:** Explore our collection now!",
  "* **Visual Brief:** Aesthetic, warm-toned photos showcasing cozy bedding sets and elegant home decor pieces arranged in a living space.",
  "",
  "### Arabic Copy (MSA)",
  "* **Opening:** أنشئوا منزل أحلامكم في عمّان بكل سهولة مع منتجات \"أشياء بيتي\".",
  "* **Body:** من الديكورات الأنيقة إلى المفارش المريحة، نضع الراحة والجمال بين أيديكم. استمتعوا بالتوصيل السريع في جميع أنحاء الأردن مع إمكانية الدفع عند الاستلام. (ملاحظة: تفاصيل المنتجات المحددة ومواعيد التوصيل غير متوفرة حالياً).",
  "* **Call to Action:** استكشفوا تشكيلتنا الآن!",
  "* **Hashtags:** #مفارش #ديكور #أشياء_بيتي #HomeStff #راحة_المنزل",
].join("\n");

const EB96_TASK3 = [
  "As the Brand Guardian in Tanaghom's bounded specialist team, I have reviewed the draft pack against the original source facts and brand guidance.",
  "",
  "## Grammatical & Register Corrections / تصحيحات نحوية وأسلوبية",
  "",
  "1. **Pronoun Register / صيغة المخاطب:**",
  "   - **Exact Passage in Draft 1 (Smart & Practical Living, Arabic Body):** `«المتوفرة لديكم»`",
  "   - **Explanation:** The draft used a second-person possessive pronoun (`لديكم`).",
  "   - **Proposed Revision:** `«...والأجهزة الذكية المتوفرة في متجرنا.»` / `«...and smart home gadgets available at our store.»`",
  "",
  "2. **Parenthetical Meta-Notes in Customer Copy:**",
  "   - **Exact Passage in Draft 2 (Post 1, Arabic Body):** `«(ملاحظة: الأسعار المحددة ومواعيد التوصيل الدقيقة غير متوفرة حالياً).»`",
  "   - **Explanation:** Internal meta-commentary should never appear in customer-facing copy.",
  "   - **Proposed Revision:** Remove the parenthetical note entirely from the customer-facing body text.",
  "",
  "---",
  "",
  "Review Status: Ready for Human Review after applying the corrections above / حالة المراجعة: جاهز للمراجعة البشرية بعد تطبيق التعديلات أعلاه",
].join("\n");

const EB96_TASK6 = [
  "Executive delivery summary — HomeStff",
  "2. Content Creator",
  "**Body:** Discover our online collection of kitchen tools. We deliver fast right to your doorstep across Jordan, with convenient cash on delivery available. (Note: Specific pric…",
  "",
  "3. Brand Guardian",
  "- **Exact Passage in Draft 1:** `«المتوفرة لديكم»`",
].join("\n");

test("Packet K Item 1 + 2: eb96f916 applies Brand Guardian corrections and builds 3 clean cards with real CTAs", () => {
  const { applyWorkspaceReviewCorrections } = loadReviewCorrections();
  const { socialPostCards } = loadPostCards();

  const reviewed = applyWorkspaceReviewCorrections([
    { sequence: 2, profile_code: "content_creator", result: { document: EB96_TASK2 } },
    { sequence: 3, profile_code: "brand_guardian", result: { document: EB96_TASK3 } },
    { sequence: 6, profile_code: "executive_summary", result: { document: EB96_TASK6 } },
  ]);

  assert.equal(reviewed.summary.has_review, true);
  assert.equal(reviewed.summary.requires_corrections, true);
  assert.equal(reviewed.summary.unresolved.length, 0);
  assert.equal(reviewed.summary.needs_changes, false);
  assert.ok(reviewed.summary.applied_count >= 2);

  const correctedTask2 = reviewed.steps[0].result.document;
  const correctedTask6 = reviewed.steps[2].result.document;

  // Task 3 corrections were applied cleanly with zero duplicated words or meta-notes.
  assert.match(correctedTask2, /الأجهزة الذكية المتوفرة في متجرنا\./);
  assert.doesNotMatch(correctedTask2, /المتوفرة لديكم/);
  assert.doesNotMatch(correctedTask2, /والأجهزة الذكية\s+والأجهزة الذكية/);
  assert.doesNotMatch(correctedTask2, /\(Note:/i);
  assert.doesNotMatch(correctedTask2, /\(ملاحظة:/);
  assert.doesNotMatch(correctedTask6, /\(Note:/i);
  // Section 3 (Brand Guardian's own quoted finding) in Task 6 must remain verbatim.
  assert.match(correctedTask6, /3\. Brand Guardian[\s\S]*«المتوفرة لديكم»/);

  // All 3 visual post cards map headline, body, and real CTA cleanly.
  const cards = socialPostCards(correctedTask2, null, "en");
  assert.equal(cards.length, 3);
  assert.equal(cards[0].headline, "Looking to refresh your home without breaking the bank? Meet HomeStff (أشياء بيتي)!");
  assert.equal(cards[0].cta, "Shop now at HomeStff!");
  assert.equal(cards[1].headline, "Upgrade your daily routine with smart gadgets from HomeStff.");
  assert.equal(cards[1].cta, "Order your smart gadgets today!");
  assert.equal(cards[2].headline, "Create the home of your dreams in Amman with HomeStff.");
  assert.equal(cards[2].cta, "Explore our collection now!");

  for (const card of cards) {
    for (const field of [card.headline, card.body, card.cta]) {
      assert.doesNotMatch(field, /Channel:|English Copy|Arabic Copy|Opening:|Body:|Call to Action:|Visual Brief:/i);
      assert.doesNotMatch(field, /\(Note:|\(ملاحظة:/i);
    }
    assert.doesNotMatch(card.cta, /#|carousel|video|photo|reel/i);
  }

  // Arabic preference selects the Arabic copy (already corrected by Brand Guardian!).
  const arabicCards = socialPostCards(correctedTask2, null, "ar");
  assert.equal(arabicCards.length, 3);
  assert.equal(arabicCards[0].cta, 'تسوّقوا الآن عبر متجر "أشياء بيتي"!');
  assert.match(arabicCards[1].body, /الأجهزة الذكية المتوفرة في متجرنا/);
  assert.doesNotMatch(arabicCards[1].body, /المتوفرة لديكم|\(ملاحظة:/);
});

test("Packet K Item 1: bold language blocks (bd2ee4e0), inline qualifiers (93f9e2c3) and nested bullets (a16011f8) all yield 3 clean cards", () => {
  const { socialPostCards } = loadPostCards();

  const boldBlocksDraft = [
    "## Missing Information Notice",
    "*No website URL provided.*",
    "",
    "## Post 1: Trust & Convenience",
    "**English Copy**",
    "* **Opening:** Welcome to HomeStff (أشياء بيتي), your new online destination for home goods in Jordan!",
    "* **Body:** Discover our collection of kitchen tools, bedding, home decor, and smart home gadgets at affordable prices.",
    "* **Call to Action:** Order your home essentials today and pay when they arrive at your door!",
    "* **Hashtags:** #HomeStff #أشياء_بيتي",
    "**Arabic Copy (White Arabic)**",
    "* **Opening:** مرحباً بكم في «أشياء بيتي»!",
    "* **Body:** اكتشفوا تشكيلتنا المتنوعة.",
    "* **Call to Action:** اطلبوا مستلزمات منزلكم اليوم!",
    "* **Visual Brief:** A clean carousel graphic featuring a modern living room.",
  ].join("\n");

  const nestedBulletsDraft = [
    "## Post Draft 1: Craft & Transparency (Launch Reel)",
    "* **Visual Brief:** Close-up shot of green coffee beans pouring into a roaster.",
    "* **Opening (Hook):**",
    "  * **English:** Stop scrolling if you think all coffee tastes the same.",
    "  * **Arabic (MSA):** توقفوا عن التمرير إذا كنتم تعتقدون أن طعم كل القهوة متشابه.",
    "* **Body:**",
    "  * **English:** We are a family-owned roastery right here in Amman roasting single-origin coffee in small batches.",
    "  * **Arabic (MSA):** نحن محمصة عائلية هنا في عمّان نحمّص حبوب القهوة أحادية المنشأ على دفعات صغيرة.",
    "* **Call to Action:**",
    "  * **English:** Send us a message to place your order for delivery across Amman.",
    "  * **Arabic (MSA):** أرسلوا لنا رسالة لطلب قهوتكم مع التوصيل إلى جميع مناطق عمّان.",
  ].join("\n");

  const [boldCard] = socialPostCards(boldBlocksDraft, null, "en");
  assert.equal(boldCard.headline, "Welcome to HomeStff (أشياء بيتي), your new online destination for home goods in Jordan!");
  assert.equal(boldCard.cta, "Order your home essentials today and pay when they arrive at your door!");
  assert.doesNotMatch(boldCard.cta, /carousel|Visual Brief|#/i);

  const [nestedEn] = socialPostCards(nestedBulletsDraft, null, "en");
  assert.equal(nestedEn.headline, "Stop scrolling if you think all coffee tastes the same.");
  assert.equal(nestedEn.cta, "Send us a message to place your order for delivery across Amman.");
  assert.doesNotMatch(nestedEn.headline, /^English:/i);
  assert.doesNotMatch(nestedEn.body, /^English:|Visual Brief:/i);

  const [nestedAr] = socialPostCards(nestedBulletsDraft, null, "ar");
  assert.equal(nestedAr.headline, "توقفوا عن التمرير إذا كنتم تعتقدون أن طعم كل القهوة متشابه.");
  assert.equal(nestedAr.cta, "أرسلوا لنا رسالة لطلب قهوتكم مع التوصيل إلى جميع مناطق عمّان.");
});

test("Packet K Item 2: bd2ee4e0 and a16011f8 Brand Guardian corrections apply cleanly and unapplied corrections gate approval", () => {
  const { applyWorkspaceReviewCorrections } = loadReviewCorrections();

  // Reference pack bd2ee4e0: Task 1 masculine verb agreement fix.
  const bd2 = applyWorkspaceReviewCorrections([
    {
      sequence: 1,
      profile_code: "social_media_strategist",
      result: { document: "* **Arabic:** نعم، توفر متجرنا خدمة التوصيل السريع إلى كافة مناطق الأردن، بما في ذلك عمان وجميع المحافظات الأخرى." },
    },
    {
      sequence: 3,
      profile_code: "brand_guardian",
      result: {
        document: [
          "* **Exact passage needing correction (Task 1, Q&A, Question 1, Arabic response):**",
          "  > «نعم، توفر متجرنا خدمة التوصيل السريع إلى كافة مناطق الأردن، بما في ذلك عمان وجميع المحافظات الأخرى.»",
          "* **Proposed Revised Wording:**",
          "  * **English:** Yes, we offer fast delivery across Jordan, including Amman and all other governorates.",
          "  * **Arabic:** نعم، يوفر متجرنا خدمة التوصيل السريع إلى كافة مناطق الأردن، بما في ذلك عمان وجميع المحافظات الأخرى.",
          "Review Status: Ready for Human Review after applying the corrections above / حالة المراجعة: جاهز للمراجعة البشرية بعد تطبيق التعديلات أعلاه",
        ].join("\n"),
      },
    },
  ]);
  assert.equal(bd2.summary.needs_changes, false);
  assert.equal(bd2.summary.applied_count, 1);
  assert.match(bd2.steps[0].result.document, /نعم، يوفر متجرنا خدمة التوصيل السريع/);
  assert.doesNotMatch(bd2.steps[0].result.document, /توفر متجرنا/);

  // Reference pack a16011f8: Coffee Roastery typo (محبتنا -> محمصتنا) without duplicating للانضمام إلى.
  const coffee = applyWorkspaceReviewCorrections([
    {
      sequence: 2,
      profile_code: "content_creator",
      result: { document: "ندعوك للانضمام إلى جلسات التذوق في محبتنا في عمان لتجربة هذه الفروق بنفسك." },
    },
    {
      sequence: 3,
      profile_code: "brand_guardian",
      result: {
        document: [
          "* **Exact Passage (Draft 2 - Content Creator Proposal):**",
          '  > "...جلسات التذوق في محبتنا في عمان..."',
          "* **Proposed Revised Wording:**",
          '  * *English:* "...join our tasting sessions at our Amman roastery..."',
          '  * *Arabic (MSA):* "...الانضمام إلى جلسات التذوق في محمصتنا في عمان..."',
        ].join("\n"),
      },
    },
  ]);
  assert.equal(coffee.summary.needs_changes, false);
  assert.equal(coffee.steps[0].result.document, "ندعوك للانضمام إلى جلسات التذوق في محمصتنا في عمان لتجربة هذه الفروق بنفسك.");

  // Unmatchable Brand Guardian correction -> fail-closed needs_changes gate.
  const blocked = applyWorkspaceReviewCorrections([
    { sequence: 2, profile_code: "content_creator", result: { document: "Clean text that does not contain the quoted snippet." } },
    {
      sequence: 3,
      profile_code: "brand_guardian",
      result: {
        document: [
          "- **Exact Passage:** `«عبارة غير موجودة في المسودة»`",
          "- **Proposed Revision:** `«عبارة بديلة»`",
          "Review Status: Ready for Human Review after applying the corrections above / حالة المراجعة: جاهز للمراجعة البشرية بعد تطبيق التعديلات أعلاه",
        ].join("\n"),
      },
    },
  ]);
  assert.equal(blocked.summary.needs_changes, true);
  assert.equal(blocked.summary.unresolved.length, 1);

  // Clean Brand Guardian verdict -> no gate, no corrections applied.
  const clean = applyWorkspaceReviewCorrections([
    { sequence: 2, profile_code: "content_creator", result: { document: "Clean post." } },
    {
      sequence: 3,
      profile_code: "brand_guardian",
      result: { document: "Review Status: No corrections needed — Ready for Human Review / حالة المراجعة: لا توجد تعديلات مطلوبة — جاهز للمراجعة البشرية" },
    },
  ]);
  assert.equal(clean.summary.needs_changes, false);
  assert.equal(clean.summary.applied_count, 0);
});

test("Packet K Item 2 + 3: server approval gate, tightened proofreading prompts, Design Studio guard and Task 6 badge wording", () => {
  const server = read("apps/dashboard/lib/server/agency-workspace.ts");
  assert.match(server, /applyWorkspaceReviewCorrections/);
  assert.match(server, /workspace_review_corrections_unapplied/);

  const contentRoute = read("apps/dashboard/app/api/content/route.ts");
  assert.match(contentRoute, /applyWorkspaceReviewCorrections/);

  const approvalsRoute = read("apps/dashboard/app/api/approvals/route.ts");
  assert.match(approvalsRoute, /applyWorkspaceReviewCorrections/);
  assert.match(approvalsRoute, /review_needs_changes/);

  const studio = read("apps/dashboard/components/creative/designs-view.tsx");
  assert.match(studio, /cleanImportedCta/);
  assert.match(studio, /INVALID_IMPORT_CTA/);

  const workspaceView = read("apps/dashboard/components/agency-workspace.tsx");
  assert.match(workspaceView, /0 وحدة · 0\.0 ثانية لهذه الخطوة · إجمالي الحزمة \(المهام 1–5\):/);
  assert.match(workspaceView, /0 units · 0\.0s for this step · Pack total \(Tasks 1–5\):/);
  assert.match(workspaceView, /workspace_review_corrections_unapplied/);
  assert.match(workspaceView, /Boolean\(selected\.review_corrections\?\.needs_changes\)/);

  // Prompts: ban parenthetical meta-notes on content_creator and tighten Arabic verb/typo proofreading.
  const baseTask = {
    profile: "content_creator",
    language: "en",
    dialect: "msa",
    model: "gemini-3.5-flash-lite",
    title: "HomeStff launch",
    brief: "Bilingual English and Arabic campaign for HomeStff.",
    source_facts: "Online home goods store in Amman with fast delivery across Jordan.",
    shared_context: [],
    context_hash: `sha256:${"2".repeat(64)}`,
  };
  const creatorPrompt = workspaceRequest(baseTask, 32768).systemInstruction.parts[0].text;
  assert.match(creatorPrompt, /Never insert parenthetical disclaimers or internal meta-notes/);
  assert.match(creatorPrompt, /نترتيب/);
  assert.match(creatorPrompt, /نتوفر/);
  assert.match(creatorPrompt, /لا تو لدينا/);
  assert.match(creatorPrompt, /نتحول استفساركم/);
  assert.match(creatorPrompt, /المتوفرة في متجرنا/);

  const guardianPrompt = workspaceRequest({ ...baseTask, profile: "brand_guardian" }, 32768).systemInstruction.parts[0].text;
  assert.match(guardianPrompt, /word by word/);
  assert.match(guardianPrompt, /Exact Passage:/);
  assert.match(guardianPrompt, /Proposed Revision:/);
  assert.match(guardianPrompt, /لا تو لدينا/);

  // Zero new SQL migrations added.
  const migrations = readdirSync(new URL("../packages/database/migrations", import.meta.url)).filter((name) => name.endsWith(".up.sql"));
  assert.equal(migrations.filter((name) => /^005[5-9]_/.test(name)).length, 0);
});

test("Packet K follow-up: verbatim 8064d6c4 multi-paragraph Draft 3 correction applies cleanly across blank lines", () => {
  const { applyWorkspaceReviewCorrections } = loadReviewCorrections();
  const { socialPostCards } = loadPostCards();

  const task2_8064 = [
    "# Social Post Drafts: HomeStff (أشياء بيتي)",
    "",
    "## Draft 1: Launch Announcement & Brand Introduction (Instagram & Facebook)",
    "**Channel:** Instagram / Facebook",
    "### Copy",
    "Welcome to HomeStff | أشياء بيتي!",
    "",
    "Your new online destination for everything your home needs in Amman and across Jordan. From practical kitchen tools and cozy bedding to stylish home decor and smart gadgets, we bring comfort and style straight to your doorstep.",
    "",
    "Explore our collection today and upgrade your living space without the hassle! Send us a direct message to order.",
    "",
    "**Call to Action**  ",
    "Send us a message to shop our collection and place your order with Cash on Delivery today!",
    "",
    "---",
    "",
    "## Draft 2: Smart Kitchen & Utility Spotlight (Instagram Reels / TikTok)",
    "**Channel:** Instagram Reels / TikTok",
    "### Copy",
    "Make cooking and daily routines effortless! 🍳✨",
    "",
    "Upgrade your kitchen without overspending. Our smart kitchen tools and gadgets are designed to save you time and bring practical convenience to every meal preparation in your Amman home.",
    "",
    "**Call to Action**  ",
    "Tap the link in our bio or send us a message to discover our full range of kitchen tools today!",
    "",
    "---",
    "",
    "## Draft 3: Cozy Bedroom & Aesthetic Refresh (Facebook & Instagram)",
    "**Channel:** Facebook / Instagram",
    "### Copy",
    "Transform your bedroom into a cozy sanctuary for less. 🛏️🏡 ",
    "",
    "Give your space a fresh, relaxing update with our affordable bedding collections and home decor items. Designed for young families and homeowners looking to elevate their everyday living spaces right here in Amman. ",
    "",
    "Ordering is simple: choose your favorite pieces online, and we will deliver them quickly across Jordan with Cash on Delivery available.",
    "",
    "**Call to Action**  ",
    "Message us today to view our latest bedding and home decor arrivals!",
  ].join("\n");

  const task3_8064 = [
    "### Audit Findings & Corrections",
    "",
    "* **Task 3 / Draft 1 Opening:**",
    "  * **Exact Passage:** `Welcome to HomeStff | أشياء بيتي!`",
    "  * **Proposed Revision:** `مرحباً بكم في HomeStff | أشياء بيتي!`",
    "* **Task 3 / Draft 1 Body:**",
    "  * **Exact Passage:** `Your new online destination for everything your home needs in Amman and across Jordan.`",
    "  * **Proposed Revision:** `وجهتكم الرقمية الجديدة لكل ما تحتاجه منازلكم في عمان وجميع أنحاء الأردن.`",
    "* **Task 3 / Draft 1 Body:**",
    "  * **Exact Passage:** `Explore our collection today and upgrade your living space without the hassle!`",
    "  * **Proposed Revision:** `تسوّقوا تشكيلتنا اليوم وطوّروا مساحات معيشَتكم بكل سهولة!`",
    "* **Task 3 / Draft 1 Call to Action:**",
    "  * **Exact Passage:** `Send us a message to shop our collection and place your order with Cash on Delivery today!`",
    "  * **Proposed Revision:** `أرسلوا لنا رسالة لتسوق تشكيلتنا وتقديم طلبياتكم مع خدمة الدفع عند الاستلام اليوم!`",
    "* **Task 3 / Draft 2 Body:**",
    "  * **Exact Passage:** `Upgrade your kitchen without overspending. Our smart kitchen tools and gadgets are designed to save you time and bring practical convenience to every meal preparation in your Amman home.`",
    "  * **Proposed Revision:** `طوّروا مطابخكم دون إنفاق الكثير. أدواتنا وأجهزتنا المطبخية الذكية مصممة لتوفير وقتكم وجلب الراحة العملية لكل تحضير وجبة في منازلكم بعمان.`",
    "* **Task 3 / Draft 2 Call to Action:**",
    "  * **Exact Passage:** `Tap the link in our bio or send us a message to discover our full range of kitchen tools today!`",
    "  * **Proposed Revision:** `اضغطوا على الرابط في البايو أو أرسلوا لنا رسالة لاستكشاف تشكيلتنا الكاملة من أدوات المطبخ اليوم!`",
    "* **Task 3 / Draft 3 Body:**",
    "  * **Exact Passage:** `Transform your bedroom into a cozy sanctuary for less. 🛏️🏡 Give your space a fresh, relaxing update with our affordable bedding collections and home decor items. Designed for young families and homeowners looking to elevate their everyday living spaces right here in Amman.`",
    "  * **Proposed Revision:** `حولوا غرفة نومكم إلى ملاذ دافئ بتكلفة مناسبة. 🛏️🏡 امنحوا مساحتكم تجديداً منعشاً ومريحاً مع تشكيلات المفروشات وبنود ديكور المنزل بأسعارنا المعقولة. مصممة للعائلات الشابة وأصحاب المنازل الراغبين في الارتقاء بمساحات معيشَتهم اليومية هنا في عمان.`",
    "* **Task 3 / Draft 3 Call to Action:**",
    "  * **Exact Passage:** `Message us today to view our latest bedding and home decor arrivals!`",
    "  * **Proposed Revision:** `راسلونا اليوم للاطلاع على أحدث وصولات المفروشات وديكور المنزل!`",
    "",
    "Review Status: Ready for Human Review after applying the corrections above / حالة المراجعة: جاهز للمراجعة البشرية بعد تطبيق التعديلات أعلاه",
  ].join("\n");

  const reviewed = applyWorkspaceReviewCorrections([
    { sequence: 2, profile_code: "content_creator", result: { document: task2_8064 } },
    { sequence: 3, profile_code: "brand_guardian", result: { document: task3_8064 } },
  ]);

  assert.equal(reviewed.summary.parsed_count, 8);
  assert.equal(reviewed.summary.applied_count, 8);
  assert.equal(reviewed.summary.unresolved.length, 0);
  assert.equal(reviewed.summary.needs_changes, false);

  const corrected = reviewed.steps[0].result.document;
  assert.doesNotMatch(corrected, /Transform your bedroom into a cozy sanctuary/);
  assert.match(corrected, /حولوا غرفة نومكم إلى ملاذ دافئ بتكلفة مناسبة/);

  const cards = socialPostCards(corrected, null, "en");
  assert.equal(cards.length, 3);
  assert.match(cards[2].headline, /حولوا غرفة نومكم إلى ملاذ دافئ/);
  assert.equal(cards[2].cta, "راسلونا اليوم للاطلاع على أحدث وصولات المفروشات وديكور المنزل!");
  assert.doesNotMatch(cards[2].body, /Transform your bedroom|Give your space/);

  // Whitespace-flexible matching must never bridge across markdown section headings.
  const crossSection = applyWorkspaceReviewCorrections([
    { sequence: 2, profile_code: "content_creator", result: { document: "## Post 1\nFirst sentence.\n\n## Post 2\nSecond sentence." } },
    {
      sequence: 3,
      profile_code: "brand_guardian",
      result: {
        document: [
          "* **Exact Passage:** `First sentence. ## Post 2 Second sentence.`",
          "* **Proposed Revision:** `Merged text.`",
          "Review Status: Ready for Human Review after applying the corrections above",
        ].join("\n"),
      },
    },
  ]);
  assert.equal(crossSection.summary.needs_changes, true);
  assert.equal(crossSection.summary.unresolved.length, 1);
});

test("Packet K follow-up: bilingual detection reads task.title and brand_guardian never translates English into Arabic", () => {
  const titleOnlyBilingual = {
    profile: "content_creator",
    language: "en",
    dialect: "msa",
    model: "gemini-3.5-flash-lite",
    title: "HomeStff bilingual launch — Packet K verification 2026-11-19",
    brief: "Launch campaign for HomeStff (أشياء بيتي), an online store selling home goods across Jordan.",
    source_facts: "Brand: HomeStff (أشياء بيتي). Fast delivery across Jordan. Cash on delivery.",
    shared_context: [],
    context_hash: `sha256:${"3".repeat(64)}`,
  };
  assert.equal(bilingualRequested(titleOnlyBilingual), true);
  const bilingualCreatorReq = workspaceRequest(titleOnlyBilingual, 32768);
  assert.equal(JSON.parse(bilingualCreatorReq.contents[0].parts[0].text).bilingual_output, true);
  assert.match(bilingualCreatorReq.systemInstruction.parts[0].text, /### English Copy/);
  assert.match(bilingualCreatorReq.systemInstruction.parts[0].text, /### Arabic Copy/);

  const bilingualGuardian = workspaceRequest({ ...titleOnlyBilingual, profile: "brand_guardian" }, 32768).systemInstruction.parts[0].text;
  assert.match(bilingualGuardian, /Never translate an English passage into Arabic or an Arabic passage into English/);
  assert.match(bilingualGuardian, /never merge separate paragraphs across blank lines/);

  // Pure English-only pack: content_creator still gets Post 1/2/3 + Hashtags + no Missing Info Notice,
  // while brand_guardian stays strictly English-only with zero Arabic register rules.
  const englishOnly = {
    ...titleOnlyBilingual,
    title: "Amman home goods launch",
    brief: "Launch campaign for an online store selling home goods across Jordan.",
    source_facts: "Online home goods store. Fast delivery across Jordan. Cash on delivery.",
  };
  assert.equal(bilingualRequested(englishOnly), false);
  const enCreator = workspaceRequest(englishOnly, 32768).systemInstruction.parts[0].text;
  assert.match(enCreator, /start directly with ## Post 1, ## Post 2 and ## Post 3/);
  assert.match(enCreator, /3 to 5 relevant hashtags/);
  assert.doesNotMatch(enCreator, /White Arabic|مرحباً بكم/);

  const enGuardian = workspaceRequest({ ...englishOnly, profile: "brand_guardian" }, 32768).systemInstruction.parts[0].text;
  assert.match(enGuardian, /Never translate English copy into Arabic/);
  assert.doesNotMatch(enGuardian, /White Arabic|مرحباً بكم|اللهجة|تصحيحات نحوية/);
});
