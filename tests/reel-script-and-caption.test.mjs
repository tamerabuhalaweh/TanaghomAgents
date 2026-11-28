import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import {
  classifyReelHook as runtimeClassifyReelHook,
  compactHookCatalogForPrompt,
  REEL_HOOK_CLASSIFY_ORDER as RUNTIME_CLASSIFY_ORDER,
  REEL_HOOK_FORMULAS as RUNTIME_FORMULAS,
} from "../packages/agent-runtime/reel-hooks.mjs";
import { normalizeContentType, workspaceArtifact, workspaceRequest } from "../packages/agent-runtime/workspace.mjs";

const requireCjs = createRequire(import.meta.url);
const ts = requireCjs("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTsModule(path, stubResolver = (id) => { throw new Error(`unexpected import: ${id}`); }) {
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

const clientHooks = loadTsModule("apps/dashboard/lib/reel-hooks.ts");
const reelScript = loadTsModule("apps/dashboard/lib/reel-script.ts", (id) => {
  if (id === "./reel-hooks") return clientHooks;
  throw new Error(`unexpected import: ${id}`);
});
const captionLib = loadTsModule("apps/dashboard/lib/instagram-caption.ts");

test("Part 1: 26 hook formulas carry EN + native AR parity and valid matchers", () => {
  assert.equal(RUNTIME_FORMULAS.length, 26);
  assert.equal(clientHooks.REEL_HOOK_FORMULAS.length, 26);
  assert.equal(RUNTIME_CLASSIFY_ORDER.length, 26);
  assert.deepEqual(JSON.parse(JSON.stringify(RUNTIME_FORMULAS)), JSON.parse(JSON.stringify(clientHooks.REEL_HOOK_FORMULAS)));
  assert.deepEqual([...RUNTIME_CLASSIFY_ORDER], [...clientHooks.REEL_HOOK_CLASSIFY_ORDER]);

  const seenIds = new Set();
  for (const formula of RUNTIME_FORMULAS) {
    assert.ok(!seenIds.has(formula.id), `duplicate formula id ${formula.id}`);
    seenIds.add(formula.id);
    assert.ok(formula.name && formula.template && formula.example && formula.on_screen && formula.best_for && formula.trap);
    assert.ok(formula.ar.name && formula.ar.template && formula.ar.example && formula.ar.example_gulf && formula.ar.on_screen && formula.ar.best_for && formula.ar.trap);
    const screenWordsEn = formula.on_screen.trim().split(/\s+/).length;
    const screenWordsAr = formula.ar.on_screen.trim().split(/\s+/).length;
    assert.ok(screenWordsEn <= 6, `EN on_screen > 6 words on #${formula.id}: ${formula.on_screen}`);
    assert.ok(screenWordsAr <= 6, `AR on_screen > 6 words on #${formula.id}: ${formula.ar.on_screen}`);
    assert.doesNotThrow(() => new RegExp(formula.match, "iu"), `invalid EN regex #${formula.id}`);
    assert.doesNotThrow(() => new RegExp(formula.ar.match, "iu"), `invalid AR regex #${formula.id}`);
  }

  assert.equal(runtimeClassifyReelHook("$18,000 is what one missing clause cost me.")?.id, 1);
  assert.equal(clientHooks.classifyReelHook("وقفوا نشر كل يوم. انشروا مرتين بس وردّوا على كل تعليق.")?.id, 2);
  assert.equal(clientHooks.classifyReelHook("محد يقولكم إن أول 30 ريلز تسوونها غالباً ما تضرب مشاهدات.")?.id, 3);
  assert.equal(clientHooks.classifyReelHook("Proposals used to take us five hours. Twenty minutes now.")?.id, 5);
});

test("Part 1: bilingual weak-hook filter kills bad hooks, scores strong EN/AR hooks, and states honest AUC scope", () => {
  assert.deepEqual(reelScript.HOOK_FILTER_SCOPE, {
    role: "weak_hook_filter",
    filter_auc: 0.83,
    winner_auc: 0.56,
  });

  // Weak EN hooks (greeting, preamble, stop scrolling, emoji+hashtag)
  const weakGreetingEn = reelScript.scoreReelHook("Hey guys today I want to talk about our amazing marketing course #viral 🚀");
  assert.equal(weakGreetingEn.verdict, "WEAK");
  assert.ok(weakGreetingEn.score < 50);
  assert.ok(weakGreetingEn.flags.length >= 2);

  const weakStopEn = reelScript.scoreReelHook("Stop scrolling right now because this tip is really helpful for your business");
  assert.equal(weakStopEn.verdict, "WEAK");
  assert.ok(weakStopEn.flags.some((f) => /stop scrolling/i.test(f.en)));

  // Weak AR hooks (greeting, preamble, stop scrolling)
  const weakGreetingAr = reelScript.scoreReelHook("أهلاً بكم يا جماعة في هذا الفيديو اليوم سنتحدث عن خدماتنا المميزة", { language: "ar" });
  assert.equal(weakGreetingAr.verdict, "WEAK");
  assert.ok(weakGreetingAr.flags.length >= 2);

  const weakStopAr = reelScript.scoreReelHook("توقفوا عن التمرير الآن لأنني سأشرح لكم موضوعاً عاماً #اكسبلور", { language: "ar" });
  assert.equal(weakStopAr.verdict, "WEAK");
  assert.ok(weakStopAr.flags.length >= 2);

  // Strong EN and AR (Gulf + MSA) hooks
  const strongEn = reelScript.scoreReelHook("Stop wasting 5 hours on your proposals — finish in 20 minutes instead.");
  assert.equal(strongEn.verdict, "STRONG");
  assert.ok(strongEn.score >= 70);
  assert.equal(strongEn.flags.length, 0);

  const strongArGulf = reelScript.scoreReelHook("تكتبون الكابشن غلط بـ 300 حرف، والغلط مو منكم.");
  assert.equal(strongArGulf.verdict, "STRONG");
  assert.ok(strongArGulf.score >= 70);
  assert.equal(strongArGulf.flags.length, 0);

  // Unconfirmed placeholder {{your number}} is flagged separately and does NOT inflate specificity
  const placeholderHook = reelScript.scoreReelHook("Your team lost {{your number}} hours because you skipped step two.");
  assert.deepEqual(placeholderHook.placeholders, ["{{your number}}"]);
  assert.equal(placeholderHook.checks.SPECIFICITY.score < 80, true);
});

test("Part 1: timed beat sheet detects slow hooks, beats > 4s, abstract runs, loop words, and {{placeholders}}", () => {
  const sampleScript = [
    "Proposals used to take your team 5 hours.",
    "Then we cut the intro and got straight to the core deliverable right away without pausing.",
    "We shared clear ideas across the whole team consistently every day.",
    "Nobody waited on vague concepts when planning their weekly schedule.",
    "Every abstract goal turned into simple steps over time for everyone involved.",
    "Cut your workflow time and save proposals.",
  ].join("\n");

  const analysis = reelScript.analyzeReelBeats(sampleScript, { wpm: 165, targetSeconds: 30, language: "en" });
  assert.ok(analysis);
  assert.equal(analysis.beats[0].label, "HOOK");
  assert.equal(analysis.beats[analysis.beats.length - 1].label, "CTA");
  assert.equal(analysis.beats[1].flags_en.some((f) => f.includes("> 4s")), true);
  assert.equal(analysis.notes_en.some((n) => n.includes("have nothing concrete in them")), true);
  assert.equal(analysis.loop.loops, true);
  assert.ok(analysis.loop.echoed_words.some((w) => /proposal/i.test(w)));

  // Arabic beat analysis + {{رقمك}} flagging + loop detection
  const arScript = [
    "تجهيز العروض كان ياخذ منكم 5 ساعات قبل التعديل.",
    "كل عرض كان يحتاج 3 جولات مراجعة.",
    "توفير الوقت رفع الطلبات بنسبة {{رقمك}} خلال أسبوعين.",
    "احفظوا هذا القالب لتسريع العروض.",
  ].join("\n");
  const arAnalysis = reelScript.analyzeReelBeats(arScript, { language: "ar", targetSeconds: 30 });
  assert.ok(arAnalysis);
  assert.equal(arAnalysis.loop.loops, true);
  assert.deepEqual(arAnalysis.placeholders, ["{{رقمك}}"]);
  assert.equal(arAnalysis.beats[2].flags_ar.some((f) => f.includes("{{رقمك}}")), true);
});

test("Part 1: Reel script parser handles structured EN & AR drafts", () => {
  const enDoc = [
    "## Hook Options",
    "Option 1 — Formula #5 (Time Collapse)",
    "Spoken Hook: Proposals used to take your team 5 hours. Now 20 minutes.",
    "On-Screen Text: 5 HOURS -> 20 MIN",
    "Why / Trap avoided: Believable 15x improvement grounded in the template.",
    "",
    "Option 2 — Formula #2 (Negative Command)",
    "Spoken Hook: Stop wasting 4 hours formatting quotes by hand without this checklist.",
    "On-Screen Text: STOP MANUAL QUOTES",
    "Why / Trap avoided: Targets a real daily bottleneck.",
    "",
    "Option 3 — Formula #16 (The Verbatim Question)",
    "Spoken Hook: Hey everyone today let's talk about proposals in this video #reels",
    "On-Screen Text: HOW TO QUOTE FAST",
    "Why / Trap avoided: Intentionally weak for test.",
    "",
    "## Chosen Reel Script",
    "Chosen Hook: Option 1",
    "Proposals used to take your team 5 hours.",
    "Most founders lose {{your number}} deals every week waiting on edits.",
    "Copy our 4-line checklist and cut quoting to 20 minutes.",
    "Comment CHECKLIST to test cleaner proposals today.",
    "",
    "## On-Screen Text",
    "- 0:00: 5 HOURS -> 20 MIN",
    "- 0:07: STOP WAITING ON EDITS",
    "- 0:15: 4-LINE QUOTE CHECKLIST",
    "- 0:24: COMMENT CHECKLIST",
    "",
    "## Instagram Caption",
    "Cut quote turnaround from 5 hours to 20 minutes with a 4-line structure.",
    "",
    "Comment CHECKLIST if you want the exact breakdown for client proposals and agency pricing.",
    "#clientproposals #agencypipeline #reelseo",
  ].join("\n");

  const parsed = reelScript.parseReelScriptDocument(enDoc, { language: "en" });
  assert.equal(parsed.hooks.length, 3);
  assert.equal(parsed.hooks[0].scored.verdict, "STRONG");
  assert.equal(parsed.hooks[2].scored.verdict, "WEAK");
  assert.equal(parsed.onScreenCards.length, 4);
  assert.ok(parsed.onScreenCards.every((c) => c.withinLimit));
  assert.deepEqual(parsed.placeholders, ["{{your number}}"]);
  assert.ok(parsed.beatSheet && parsed.beatSheet.beats.length === 4);
  assert.equal(parsed.beatSheet.loop.loops, true);
  assert.match(parsed.caption, /Comment CHECKLIST/);
});

test("Part 2: 125-char Instagram caption preview & linter supports EN and AR with 5-hashtag cap", () => {
  // EN caption exceeding 5 hashtags -> FAIL
  const tooManyTags = "5 edits doubled our saves in 14 days for client proposals.\n\nComment GUIDE below.\n#a #b #c #d #e #f";
  const failedTags = captionLib.analyzeInstagramCaption(tooManyTags, { keywords: ["client proposals"] });
  assert.equal(failedTags.verdict, "FIX");
  assert.equal(failedTags.checks.find((c) => c.id === "HASHTAGS").status, "FAIL");
  assert.equal(failedTags.checks.find((c) => c.id === "SEARCH_TERMS").status, "PASS");

  // Long EN line > 125 chars -> exact 125-char slice + FIRST_LINE WARN
  const longLine1 = "Stop wasting three hours every single morning rewriting client proposals before a discovery call when you could finish in twenty minutes and save every lead today.\n\nSave this post.\n#agencyops #proposals";
  const longRes = captionLib.analyzeInstagramCaption(longLine1);
  assert.equal(Array.from(longRes.visible).length, 125);
  assert.equal(longRes.truncated, true);
  assert.equal(longRes.checks.find((c) => c.id === "FIRST_LINE").status, "WARN");

  // > 2200 chars -> FAIL LENGTH
  const over2200 = `${"Word ".repeat(450)}\n#one #two`;
  assert.equal(captionLib.analyzeInstagramCaption(over2200).checks.find((c) => c.id === "LENGTH").status, "FAIL");

  // AR caption: exact 125-char truncation, 5 specific Arabic tags PASS, filler AR #اكسبلور WARN, AR CTA + search terms
  const arCaption = [
    "5 خطوات اختصرت إعداد العروض من 5 ساعات إلى 20 دقيقة لفريقنا.",
    "",
    "أضيفوا كلمات البحث في صلب الوصف مثل التسويق الرقمي وإدارة الحملات بدل حشو الهاشتاقات في آخر المنشور، وراقبوا فرق التفاعل خلال 14 يوماً.",
    "",
    "اكتبوا كلمة خطة في التعليقات لنرسل لكم التفاصيل.",
    "#التسويق_الرقمي #إدارة_الحملات #نصائح_إنستغرام",
  ].join("\n");
  const arRes = captionLib.analyzeInstagramCaption(arCaption, { keywords: ["التسويق الرقمي", "ادارة الحملات"] });
  assert.equal(Array.from(arRes.visible).length, 125);
  assert.equal(arRes.truncated, true);
  assert.equal(arRes.hashtags.length, 3);
  assert.equal(arRes.checks.find((c) => c.id === "FIRST_LINE").status, "PASS");
  assert.equal(arRes.checks.find((c) => c.id === "HASHTAGS").status, "PASS");
  assert.equal(arRes.checks.find((c) => c.id === "ONE_ASK").status, "PASS");
  assert.equal(arRes.checks.find((c) => c.id === "SEARCH_TERMS").status, "PASS");
  assert.equal(arRes.verdict, "READY");

  // AR generic filler tag + 2 asks + dead link -> REVIEW
  const arNoisy = "خطة بسيطة للبدء اليوم 👇\nhttps://e3lani.online/demo\nاحفظوا هذا المنشور أو راسلونا على الخاص.\n#اكسبلور #ترند";
  const arNoisyRes = captionLib.analyzeInstagramCaption(arNoisy);
  assert.equal(arNoisyRes.verdict, "REVIEW");
  assert.equal(arNoisyRes.checks.find((c) => c.id === "LINKS").status, "WARN");
  assert.equal(arNoisyRes.checks.find((c) => c.id === "ONE_ASK").status, "WARN");
  assert.equal(arNoisyRes.checks.find((c) => c.id === "HASHTAGS").status, "WARN");
});

test("Runtime & Server: Reel script prompt fits budgets, preserves social_posts default, adds 0 migrations, and skips image spend", () => {
  assert.equal(normalizeContentType(undefined), "social_posts");
  assert.equal(normalizeContentType("reel_script"), "reel_script");
  assert.equal(normalizeContentType("carousel_only"), null);

  const base = {
    profile: "content_creator",
    language: "en",
    dialect: "msa",
    model: "gemini-3.5-flash-lite",
    title: "Excellence Camp Reel launch",
    brief: "Create a 30-second Instagram Reel script with 3 hooks and caption.",
    source_facts: "Program: Excellence Camp, 4 weeks, 180 JOD before Jan 20. No conversion metric confirmed.",
    shared_context: [{ task_id: "t1", profile: "social_media_strategist", response_hash: "h1", document: "Focus on 30-second speed benefit." }],
    context_hash: `sha256:${"4".repeat(64)}`,
  };

  assert.throws(() => workspaceRequest({ ...base, content_type: "invalid" }, 32768), /workspace_content_type_invalid/);

  // Default social_posts remains free of REEL SCRIPT MODE
  const defaultReq = workspaceRequest(base, 32768);
  assert.doesNotMatch(defaultReq.systemInstruction.parts[0].text, /REEL SCRIPT MODE/);
  assert.equal("content_type" in JSON.parse(defaultReq.contents[0].parts[0].text), false);

  // Reel script EN, Gulf AR, and Bilingual all stay well under 32768 budget and 64KB max request
  for (const variant of [
    { ...base, content_type: "reel_script" },
    { ...base, language: "ar", dialect: "gulf", content_type: "reel_script", title: "نص ريلز لمخيّم التميّز" },
    { ...base, content_type: "reel_script", brief: "Write a bilingual English and Arabic ~30s Reel script." },
  ]) {
    const req = workspaceRequest(variant, 32768);
    const sys = req.systemInstruction.parts[0].text;
    assert.match(sys, /REEL SCRIPT MODE/);
    assert.match(sys, /26 Hook Formulas Playbook/);
    assert.match(sys, /\{\{your number\}\}/);
    assert.match(sys, /125 characters/);
    assert.equal(JSON.parse(req.contents[0].parts[0].text).content_type, "reel_script");
    assert.ok(Buffer.byteLength(JSON.stringify(req), "utf8") < 32768);
  }

  // Executive summary mentions Reel script when content_type === 'reel_script'
  const summary = workspaceArtifact({ ...base, profile: "executive_summary", content_type: "reel_script" }, null, 0);
  assert.match(summary.document, /Content type: Reel script/);

  // Zero new SQL migrations & server skips AI images for reel_script
  const migrations = readdirSync(new URL("../packages/database/migrations", import.meta.url)).filter((name) => name.endsWith(".up.sql"));
  assert.equal(migrations.filter((name) => /^005[5-9]_/.test(name)).length, 0);

  const server = read("apps/dashboard/lib/server/agency-workspace.ts");
  assert.match(server, /selected&&selected\.content_type!=="reel_script"&&creatorDoc/);
  assert.match(server, /task\.profile==="content_creator"&&task\.content_type!=="reel_script"&&artifact\?\.document/);
  assert.match(server, /workspace_content_type_invalid/);

  // UI explicitly shows honest AUC 0.83 / 0.56 scope and never promises virality
  const studioSource = read("apps/dashboard/components/reel-script-studio.tsx");
  assert.match(studioSource, /HOOK_FILTER_SCOPE\.filter_auc/);
  assert.match(studioSource, /HOOK_FILTER_SCOPE\.winner_auc/);
  assert.doesNotMatch(studioSource, /will go viral|سيصبح فيرال/i);
});

test("Regression: numbered headings, Spoken script header, Why/Trap avoided labels, and live EN/AR CTAs parse cleanly", () => {
  const liveEnNumbered = [
    "(1) ## Hook Options — Provide 3 hooks from 3 DISTINCT formula IDs",
    "Option 1 — Formula #1 (Cost Confession)",
    "Spoken Hook: 180 JOD is what waiting past January 20th costs founders joining Excellence Camp.",
    "On-Screen Text: 180 JOD DEADLINE",
    "Why / Trap avoided: Uses a strict, genuine price point rather than fake cost.",
    "",
    "(2) ## Chosen Reel Script — Name which option wins",
    "Chosen Hook: Option 1.",
    "180 JOD is what waiting past January 20th costs founders.",
    "Secure your spot before January 20th at 180 JOD.",
    "",
    "(3) ## On-Screen Text — Separate cards",
    "0:00: 180 JOD DEADLINE",
    "",
    "(4) ## Instagram Caption — Job A caption",
    "Join Excellence Camp for a 4-week cohort. Secure your seat today before registration closes.",
    "#AICamp #Founders",
  ].join("\n");

  const enParsed = reelScript.parseReelScriptDocument(liveEnNumbered, { language: "en" });
  assert.equal(enParsed.hooks.length, 1);
  assert.match(enParsed.hooks[0].why, /Uses a strict, genuine price point/);
  assert.equal(enParsed.beatSheet.beats.length, 2);
  assert.equal(enParsed.onScreenCards.length, 1);
  const enCap = captionLib.analyzeInstagramCaption(enParsed.caption);
  assert.equal(enCap.asks.length, 1);
  assert.equal(enCap.checks.find((c) => c.id === "ONE_ASK").status, "PASS");

  const arLive = [
    "## خيارات الخطاف",
    "Option 1 — Formula #1 (اعتراف التكلفة)",
    "Spoken Hook: ١٨٠ ديناراً راحت علينا قبل ما نعرف هالغلطة بالتسويق.",
    "On-Screen Text: غلطة بـ ١٨٠ ديناراً",
    "Why / Trap avoided: يربط خسارة محددة بتكلفة البرنامج.",
    "## النص المنطوق المختار",
    "Chosen Hook: Option 1",
    "Spoken script:",
    "١٨٠ ديناراً راحت علينا قبل ما نعرف هالغلطة بالتسويق.",
    "احجزوا مقاعدكم اليوم بنفس السعر.",
    "## وصف إنستغرام",
    "اطلبوا التفاصيل الآن واحجزوا مقاعدكم قبل اكتمال العدد.",
    "#مخيم_التميز",
  ].join("\n");
  const arParsed = reelScript.parseReelScriptDocument(arLive, { language: "ar" });
  assert.equal(arParsed.hooks[0].scored.checks.ADDRESS.score, 70);
  assert.equal(arParsed.beatSheet.beats.length, 2);
  assert.doesNotMatch(arParsed.beatSheet.beats[0].text, /Spoken script/i);
  const arCap = captionLib.analyzeInstagramCaption(arParsed.caption);
  assert.equal(arCap.asks.length, 1);
  assert.equal(arCap.checks.find((c) => c.id === "ONE_ASK").status, "PASS");

  // Clean prompt emits headings without (1) prefix right before ##
  const enReq = workspaceRequest({
    profile: "content_creator",
    language: "en",
    dialect: "msa",
    content_type: "reel_script",
    model: "gemini-3.5-flash-lite",
    title: "Test",
    brief: "Organic ~30s Reel script for product launch.",
    source_facts: "Product costs 99 USD.",
    shared_context: [],
    context_hash: `sha256:${"5".repeat(64)}`,
  }, 32768);
  assert.doesNotMatch(enReq.systemInstruction.parts[0].text, /\(1\)\s*## Hook Options/);
});
