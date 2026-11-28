import { classifyReelHook, type ReelHookFormula, REEL_HOOK_FORMULAS } from "./reel-hooks";

export const HOOK_FILTER_SCOPE = Object.freeze({
  role: "weak_hook_filter" as const,
  filter_auc: 0.83,
  winner_auc: 0.56,
});

export const HOOK_WINDOW_SECONDS = 3.0;
export const MAX_BEAT_SECONDS = 4.0;
export const ABSTRACT_RUN_LIMIT = 3;
export const DEFAULT_TARGET_SECONDS = 30;
export const DEFAULT_WPM_EN = 165;
export const DEFAULT_WPM_AR = 140;
export const MAX_ON_SCREEN_WORDS = 6;

export type HookVerdict = "STRONG" | "OK" | "WEAK";

export interface HookCheckResult {
  id: "LENGTH" | "SPECIFICITY" | "STAKES" | "FRONTLOAD" | "ADDRESS";
  score: number;
  detail_en: string;
  detail_ar: string;
}

export interface HookDealbreaker {
  en: string;
  ar: string;
}

export interface ReelHookScore {
  hook: string;
  language: "en" | "ar";
  score: number;
  verdict: HookVerdict;
  weakest: HookCheckResult["id"];
  flags: HookDealbreaker[];
  checks: Record<HookCheckResult["id"], HookCheckResult>;
  placeholders: string[];
  formula: { id: number; name: string; name_ar: string } | null;
  scope: typeof HOOK_FILTER_SCOPE;
}

export interface ReelBeatRow {
  n: number;
  start: number;
  dur: number;
  timecode: string;
  words: number;
  text: string;
  concrete: number;
  placeholders: string[];
  label: "" | "HOOK" | "MID" | "CTA" | "HOOK/CTA";
  flags_en: string[];
  flags_ar: string[];
}

export interface ReelBeatAnalysis {
  language: "en" | "ar";
  wpm: number;
  target_seconds: number;
  total_seconds: number;
  total_words: number;
  beats: ReelBeatRow[];
  loop: {
    loops: boolean;
    echoed_words: string[];
  };
  placeholders: string[];
  flags_count: number;
  notes_en: string[];
  notes_ar: string[];
}

export interface ParsedHookOption {
  optionIndex: number;
  formulaId: number | null;
  formulaName: string;
  spoken: string;
  onScreen: string;
  onScreenWords: number;
  onScreenOk: boolean;
  why: string;
  scored: ReelHookScore;
}

export interface ParsedOnScreenCard {
  index: number;
  timecode: string;
  text: string;
  words: number;
  withinLimit: boolean;
}

export interface ParsedReelScript {
  language: "en" | "ar";
  hasEnglishSection: boolean;
  hasArabicSection: boolean;
  hooks: ParsedHookOption[];
  chosenNote: string;
  spokenScript: string;
  beatSheet: ReelBeatAnalysis | null;
  onScreenCards: ParsedOnScreenCard[];
  caption: string;
  placeholders: string[];
}

const ARABIC_CHAR_RE = /[\u0600-\u06ff]/u;
const PLACEHOLDER_RE = /\{\{([^}]{1,80})\}\}/g;
const DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٪": "%",
};

function toLatinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹٪]/g, (ch) => DIGIT_MAP[ch] ?? ch);
}

function normalizeArabicToken(token: string): string {
  return toLatinDigits(token)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/gu, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

function stripArabicClitics(norm: string): string {
  let out = norm;
  if (/^[وبفل](?=ال[\u0621-\u064A]{2,})/u.test(out)) out = out.slice(1);
  if (out.startsWith("ال") && out.length >= 4) out = out.slice(2);
  return out;
}

export function extractPlaceholders(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const raw = `{{${m[1].trim()}}}`;
    if (!seen.has(raw)) {
      seen.add(raw);
      matches.push(raw);
    }
  }
  return matches;
}

function stripPlaceholdersForConcrete(text: string): string {
  return text.replace(PLACEHOLDER_RE, " ").replace(/\s+/g, " ").trim();
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function countWordsArray(text: string): string[] {
  const cleaned = toLatinDigits(text.replace(PLACEHOLDER_RE, " $1 "))
    .replace(/(?<=\d)[,٬،](?=\d)/g, "")
    .trim();
  if (!cleaned) return [];
  const tokens = cleaned.match(/[\p{L}\p{N}$%€£+'’_-]+/gu) ?? [];
  return tokens.filter((t) => /[\p{L}\p{N}$]/u.test(t));
}

const NUMBER_PATTERN =
  /(?:\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|k|m|x|hrs?|hours?|mins?|minutes?|secs?|seconds?|days?|weeks?|months?|years?|usd|sar|aed|jod|دولار|ريال|درهم|دينار|ثانية|ثوان|دقيقة|دقائق|ساعة|ساعات|يوم|أيام|ايام|أسبوع|أسابيع|شهر|شهور|أشهر|سنة|سنوات|سنين)?(?=$|\s|[.,،؛:?!؟)]))/giu;

const SPOKEN_NUMBERS_EN = new Set([
  "zero", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "fifteen", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million",
  "billion", "dozen", "half", "twice", "triple",
]);

const MONEY_WORDS_EN = new Set([
  "dollars", "dollar", "bucks", "grand", "percent", "cents",
  "millionaire", "billionaire", "revenue", "profit", "salary", "rent",
]);

const SPOKEN_NUMBERS_AR = new Set([
  "صفر", "اثنين", "اثنان", "ثنتين", "ثلاث", "ثلاثه", "اربع", "اربعه", "خمس", "خمسه",
  "ست", "سته", "سبع", "سبعه", "ثمان", "ثمانيه", "تسع", "تسعه", "عشر", "عشره",
  "عشرين", "ثلاثين", "اربعين", "خمسين", "ستين", "سبعين", "ثمانين", "تسعين",
  "ميه", "مايه", "الف", "الاف", "مليون", "مليار", "نص", "نصف", "ضعف", "مرتين",
  "دولار", "ريال", "درهم", "دينار", "بالميه", "فالميه", "ثواني", "دقائق", "دقايق",
  "ساعات", "ايام", "اسابيع", "شهور", "سنين", "سنوات",
].map(normalizeArabicToken));

const STAKES_EN = new Set([
  "stop", "never", "wrong", "mistake", "mistakes", "lost", "lose", "losing",
  "cost", "costs", "broke", "broken", "failed", "failure", "fail", "nobody",
  "no", "not", "don't", "dont", "doesn't", "didn't", "can't", "won't",
  "quit", "quitting", "fired", "deleted", "delete", "killed", "kills", "kill",
  "replaced", "replaces", "cut", "beat", "free", "paid", "charged", "hired",
  "saved", "first", "banned", "illegal", "worst", "hate", "hated", "wasted",
  "waste", "scam", "lie", "lied", "lying", "truth", "secret", "hidden", "stole",
  "stolen", "before", "until", "instead", "but", "except", "unless", "problem",
  "risk", "danger", "warning", "regret", "wish", "should", "shouldn't", "still",
  "already", "only", "without", "versus", "vs", "actually",
]);

const STAKES_AR = new Set([
  "وقفوا", "توقفوا", "اوقفوا", "غلط", "خطا", "خساره", "خسرنا", "خسرت",
  "راحت", "كلف", "تكلف", "مشكله", "فشل", "فشلت", "محد", "لا", "مو", "مش",
  "ما", "بدون", "بدل", "بدلا", "عوضا", "قبل", "الا", "لكن", "بس", "سر",
  "حقيقه", "وهم", "كذبه", "خطر", "تحذير", "ندم", "تضيع", "يضيع", "تضيعون",
  "اغلي", "ارخص", "اسرع", "اسوا", "وحيد", "وحده", "فقط", "مقابل", "ضد",
  "تحتاجون", "تنشروا", "تدفعوا", "تصرفوا", "بلاش", "ممنوع", "اغنتنا", "غنتنا",
  "صادم", "اكبر", "افضل", "اقل", "اكثر", "ينقطع", "تخسرون", "يفقدكم", "نقص",
].map(normalizeArabicToken));

const WEAK_OPENERS_EN = [
  "so", "ok", "okay", "hey", "hi", "hello", "guys", "yo", "alright",
  "welcome", "today", "basically", "honestly", "look", "listen", "um",
  "just", "let", "lets", "let's", "i wanted", "i want", "one of",
  "have you", "did you", "do you", "are you", "in this", "in today",
  "the thing", "a lot", "there is", "there are", "this is", "it is",
  "as a", "when it", "if you've", "you know",
];

const WEAK_OPENERS_AR = [
  "اهلا", "مرحبا", "السلام عليكم", "هلا", "هلا والله", "اليوم", "في هذا الفيديو",
  "في هذا الريل", "في فيديو اليوم", "بهذا الفيديو", "بصراحه", "يعني", "طبعا",
  "هل سبق", "حابين", "حبيت", "خلونا اليوم", "يا جماعه", "احنا اليوم", "بنحكي اليوم",
  "بداية", "اهلا بكم", "مرحبا بكم",
];

const IMPERATIVES_EN = new Set([
  "stop", "steal", "copy", "delete", "try", "watch", "read", "save",
  "use", "build", "make", "write", "send", "take", "start", "quit",
  "never", "always", "don't", "dont", "do", "put", "run", "check", "drop", "fix",
]);

const IMPERATIVES_AR = new Set([
  "وقفوا", "توقفوا", "اوقفوا", "خذوا", "جربوا", "احفظوا", "شوفوا", "شاهدوا",
  "اسحبوا", "انسخوا", "طبقوا", "قارنوا", "ابدووا", "ابداوا", "احسبوا", "راجعوا",
  "انتبهوا", "غيروا", "خلوا", "دعوا", "عدلوا", "اكشفوا", "اقطعوا",
].map(normalizeArabicToken));

const VIEWER_ADDRESS_AR_RE =
  /(?:^|\s)(?:أنتم|انتم|عندكم|حسابكم|مشروعكم|عملائكم|عملاءكم|متجركم|إعلاناتكم|اعلاناتكم|محتواكم|وقتكم|ميزانيتكم|فريقكم|منتجكم|عملكم|شغلكم|مبيعاتكم|جمهوركم|مقاطعكم|منشوراتكم|كابشنكم|وصفكم|عروضكم|طلباتكم|استفساراتكم|عليكم|لكم|معكم|فيكم|منكم|بكم|تبحثون|تحتاجون|تريدون|تبون|تعرفون|تضيعون|تدفعون|تستخدمون|تسوون|تعملون|تنشرون|تكتبون|تخسرون|تتجاهلون|كنتم|واجهتم|بديتوا|قرأتم)(?:\s|[؟?!.,،؛:]|$)/iu;

const DEALBREAKERS: { pattern: RegExp; en: string; ar: string }[] = [
  {
    pattern: /^\s*(?:stop scrolling|don'?t scroll|توقفوا عن التمرير|توقف عن التمرير|وقف التمرير|لا تتجاوز|لا تسحب)/iu,
    en: 'Opens with "stop scrolling". Asking for attention proves you have not earned it.',
    ar: 'يبدأ بعبارة «توقف عن التمرير». استجداء الانتباه يضعف الخطاف من الثانية الأولى.',
  },
  {
    pattern: /\b(?:in (?:this|today'?s) (?:video|reel)|i'?m going to show you|i'?ll show you how|we'?ll show you)\b|(?:في هذا الفيديو|في هذا الريل|في فيديو اليوم|اليوم سأشرح|اليوم راح أوريكم|اليوم سوف نتحدث)/iu,
    en: "Video preamble. Delete it and open on the payoff.",
    ar: "مقدمة تقليدية («في هذا الفيديو / اليوم سأشرح»). احذفوها وابدؤوا بالنتيجة مباشرة.",
  },
  {
    pattern: /^\s*(?:hey |hi |hello |what'?s up |welcome )|^\s*(?:أهلاً|اهلا|أهلا بكم|مرحباً|مرحبا بكم|السلام عليكم|هلا والله)(?=$|\s|[.,،؛:?!؟])/iu,
    en: "Greeting opener. Nobody stops scrolling for a greeting.",
    ar: "بداية بترحيب («أهلاً / مرحباً»). المشاهد لا يتوقف للتحية في أول ثانيتين.",
  },
  {
    pattern: /(?:^|\s)#[\p{L}\p{N}_]+/u,
    en: "Hashtag in the hook. Hashtags belong at the bottom of the caption, if anywhere.",
    ar: "وجود هاشتاق داخل الخطاف. مكان الهاشتاقات أسفل الوصف فقط (وبحد أقصى 5).",
  },
  {
    pattern: /\p{Extended_Pictographic}/u,
    en: "Emoji inside the hook line. Keep the spoken/headline hook clean and blunt.",
    ar: "إيموجي داخل نص الخطاف. اجعلوا نص الخطاف صريحاً وواضحاً بدون إيموجي.",
  },
];

function extractConcreteMarkers(text: string): string[] {
  const withoutPlaceholders = stripPlaceholdersForConcrete(text);
  const latinized = toLatinDigits(withoutPlaceholders);
  const nums = [...latinized.matchAll(NUMBER_PATTERN)].map((m) => m[0].trim()).filter(Boolean);
  const rawTokens = countWordsArray(withoutPlaceholders);
  const propers = new Set<string>();
  const spoken: string[] = [];

  rawTokens.forEach((rawToken, index) => {
    const cleanEn = rawToken.toLowerCase().replace(/^['’]|['’]$/g, "");
    const cleanAr = stripArabicClitics(normalizeArabicToken(rawToken));
    if (index > 0 && /^[A-Z][a-z]{2,}$/.test(rawToken) && !STAKES_EN.has(cleanEn) && !IMPERATIVES_EN.has(cleanEn)) {
      propers.add(rawToken);
    }
    if (SPOKEN_NUMBERS_EN.has(cleanEn) || MONEY_WORDS_EN.has(cleanEn)) {
      spoken.push(rawToken);
    } else if (SPOKEN_NUMBERS_AR.has(cleanAr) || SPOKEN_NUMBERS_AR.has(normalizeArabicToken(rawToken))) {
      spoken.push(rawToken);
    }
  });

  return [...nums, ...sortedUnique(propers), ...spoken];
}

function sortedUnique(set: Set<string>): string[] {
  return [...set].sort((a, b) => a.localeCompare(b));
}

function extractStakesMarkers(text: string): string[] {
  const withoutPlaceholders = stripPlaceholdersForConcrete(text);
  const rawTokens = countWordsArray(withoutPlaceholders);
  const markers = new Set<string>();

  for (const token of rawTokens) {
    const en = token.toLowerCase().replace(/^['’]|['’]$/g, "");
    if (STAKES_EN.has(en)) markers.add(en);
    const arRaw = normalizeArabicToken(token);
    const arStem = stripArabicClitics(arRaw);
    if (STAKES_AR.has(arRaw) || STAKES_AR.has(arStem)) markers.add(token);
  }

  if (/\$\s?\d|\d[\d,]*\s*(?:ريال|درهم|دينار|دولار)/iu.test(toLatinDigits(withoutPlaceholders))) {
    markers.add("price");
  }
  return [...markers];
}

function checkLength(text: string, isAr: boolean): HookCheckResult {
  const w = countWordsArray(text);
  const n = w.length;
  const wps = isAr ? DEFAULT_WPM_AR / 60 : DEFAULT_WPM_EN / 60;
  const secs = n / wps;
  const chars = Array.from(text.trim()).length;

  let score = 100;
  if (n < 5) score = clamp(100 - (5 - n) * 20);
  else if (n > 12) score = clamp(100 - (n - 12) * 11);
  if (chars > (isAr ? 68 : 60)) score = clamp(score - 12);

  return {
    id: "LENGTH",
    score: Math.round(score),
    detail_en: `${n} words, ${chars} chars, ~${secs.toFixed(1)}s spoken (target 5–12 words, <=3s)`,
    detail_ar: `${n} كلمات، ${chars} حرفاً، ~${secs.toFixed(1)} ثانية نطقاً (المثالي 5–12 كلمة، ≤ 3 ثوانٍ)`,
  };
}

function checkSpecificity(text: string): HookCheckResult {
  const markers = extractConcreteMarkers(text);
  const hits = markers.length;
  const score = hits === 0 ? 15 : clamp(45 + hits * 30);
  const preview = markers.slice(0, 4).join(", ");

  return {
    id: "SPECIFICITY",
    score: Math.round(score),
    detail_en: hits > 0
      ? `${hits} concrete marker(s): ${preview}`
      : "0 concrete markers — no number, price, or specific name",
    detail_ar: hits > 0
      ? `${hits} مؤشر ملموس: ${preview}`
      : "لا يوجد رقم أو مبلغ أو اسم محدد يمكن التحقق منه",
  };
}

function checkStakes(text: string): HookCheckResult {
  const markers = extractStakesMarkers(text);
  const n = markers.length;
  const score = n === 0 ? 20 : n === 1 ? 70 : 100;

  return {
    id: "STAKES",
    score,
    detail_en: n > 0
      ? `${n} tension/cost marker(s): ${markers.slice(0, 4).join(", ")}`
      : "0 tension markers — nothing appears at stake",
    detail_ar: n > 0
      ? `${n} مؤشر توتر أو تكلفة: ${markers.slice(0, 4).join("، ")}`
      : "لا يوجد توتر أو خسارة أو مصلحة تدفع المشاهد للاستمرار",
  };
}

function checkFrontload(text: string): HookCheckResult {
  const tokens = countWordsArray(text);
  if (!tokens.length) {
    return { id: "FRONTLOAD", score: 0, detail_en: "Empty hook", detail_ar: "خطاف فارغ" };
  }

  const lowEn = tokens.map((t) => t.toLowerCase().replace(/^['’]|['’]$/g, ""));
  const lowAr = tokens.map((t) => normalizeArabicToken(t));
  const openerEn = lowEn.slice(0, 3).join(" ");
  const openerAr = lowAr.slice(0, 3).join(" ");

  let penalty = 0;
  let hitOpener = "";
  for (const weak of WEAK_OPENERS_EN) {
    if (openerEn.startsWith(`${weak} `) || lowEn[0] === weak) {
      penalty = 30;
      hitOpener = weak;
      break;
    }
  }
  if (!hitOpener) {
    for (const weak of WEAK_OPENERS_AR) {
      if (openerAr.startsWith(weak) || lowAr[0] === weak) {
        penalty = 30;
        hitOpener = tokens[0];
        break;
      }
    }
  }

  let payloadIdx: number | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i];
    const en = lowEn[i];
    const ar = lowAr[i];
    const arStem = stripArabicClitics(ar);
    const hasDigit = /\d/.test(toLatinDigits(raw));
    const hasProp = i > 0 && /^[A-Z][a-z]{2,}$/.test(raw);
    if (
      hasDigit ||
      hasProp ||
      STAKES_EN.has(en) ||
      SPOKEN_NUMBERS_EN.has(en) ||
      MONEY_WORDS_EN.has(en) ||
      STAKES_AR.has(ar) ||
      STAKES_AR.has(arStem) ||
      SPOKEN_NUMBERS_AR.has(ar) ||
      SPOKEN_NUMBERS_AR.has(arStem)
    ) {
      payloadIdx = i;
      break;
    }
  }

  let base = 30;
  let whereEn = "No payload word anywhere in the line";
  let whereAr = "لا توجد كلمة محورية جاذبة في السطر";
  if (payloadIdx !== null) {
    if (payloadIdx <= 3) {
      base = 100;
      whereEn = `Payload lands at word ${payloadIdx + 1}`;
      whereAr = `الفكرة الجوهرية في الكلمة ${payloadIdx + 1}`;
    } else if (payloadIdx <= 6) {
      base = 70;
      whereEn = `Payload at word ${payloadIdx + 1} (could move forward)`;
      whereAr = `الفكرة الجوهرية عند الكلمة ${payloadIdx + 1} (يفضّل تقديمها)`;
    } else {
      base = 40;
      whereEn = `Payload at word ${payloadIdx + 1} (too late)`;
      whereAr = `الفكرة الجوهرية متأخرة عند الكلمة ${payloadIdx + 1}`;
    }
  }

  const finalScore = clamp(base - penalty);
  return {
    id: "FRONTLOAD",
    score: Math.round(finalScore),
    detail_en: `${whereEn}${hitOpener ? `; weak opener "${hitOpener}"` : ""}`,
    detail_ar: `${whereAr}${hitOpener ? `؛ بداية ضعيفة «${hitOpener}»` : ""}`,
  };
}

function checkAddress(text: string, isAr: boolean): HookCheckResult {
  const tokens = countWordsArray(text);
  const low = text.toLowerCase();
  const enFirst = tokens[0]?.toLowerCase().replace(/^['’]|['’]$/g, "") ?? "";
  const arFirst = tokens[0] ? normalizeArabicToken(tokens[0]) : "";

  if (!isAr) {
    if (/\b(you|your|you're|youre|yourself)\b/i.test(low)) {
      return { id: "ADDRESS", score: 100, detail_en: "Speaks directly to the viewer", detail_ar: "يخاطب المشاهد مباشرة" };
    }
    if (IMPERATIVES_EN.has(enFirst)) {
      return { id: "ADDRESS", score: 90, detail_en: `Imperative opener ("${tokens[0]}")`, detail_ar: `بداية بصيغة أمر مباشر («${tokens[0]}»)` };
    }
    if (/\b(i|my|me|we|our|us)\b/i.test(low)) {
      return { id: "ADDRESS", score: 70, detail_en: "First person, no direct 'you' yet", detail_ar: "بصيغة المتكلم دون مخاطبة مباشرة" };
    }
    return { id: "ADDRESS", score: 35, detail_en: "Third person — nobody in the room", detail_ar: "بصيغة الغائب دون توجيه للمشاهد" };
  }

  if (VIEWER_ADDRESS_AR_RE.test(text) || /\b(you|your)\b/i.test(low)) {
    return { id: "ADDRESS", score: 100, detail_en: "Speaks directly to viewers (plural-polite Arabic)", detail_ar: "يخاطب الجمهور مباشرة بصيغة الجمع المهذبة" };
  }
  if (IMPERATIVES_AR.has(arFirst) || /^(?:لا\s+(?:تضيعوا|تنشروا|تدفعوا|تشتروا|تصرفوا))/u.test(normalizeArabicToken(text.trim()))) {
    return { id: "ADDRESS", score: 90, detail_en: `Imperative opener ("${tokens[0]}")`, detail_ar: `بداية بفعل أمر موجه للجمهور («${tokens[0]}»)` };
  }
  if (/(?:^|\s)(?:أنا|نحن|إحنا|حنا|فريقنا|تجربتنا|متجرنا|خسرنا|جرّبنا|جربنا|قضينا|أنفقنا|صرفنا|علينا|منا|منّا|معنا|لنا|عندنا|فينا|حسابنا)(?:\s|[.,،]|$)/u.test(text)) {
    return { id: "ADDRESS", score: 70, detail_en: "First-person story; consider naming the viewer too", detail_ar: "تجربة شخصية؛ يفضّل ربطها بمصلحة المشاهد" };
  }
  return { id: "ADDRESS", score: 35, detail_en: "Third person — no direct viewer address", detail_ar: "خطاب عام بصيغة الغائب دون توجيه للمشاهد" };
}

/**
 * Deterministic bilingual weak-hook filter.
 * Honest scope: AUC 0.83 separating strong hooks from weak openings;
 * AUC 0.56 between two decent hooks (never a virality predictor).
 */
export function scoreReelHook(
  text: string,
  options: { language?: "en" | "ar" } = {},
): ReelHookScore {
  const hook = (text ?? "").trim();
  const isAr = options.language === "ar" || ARABIC_CHAR_RE.test(hook);
  const language: "en" | "ar" = isAr ? "ar" : "en";

  const checks: Record<HookCheckResult["id"], HookCheckResult> = {
    LENGTH: checkLength(hook, isAr),
    SPECIFICITY: checkSpecificity(hook),
    STAKES: checkStakes(hook),
    FRONTLOAD: checkFrontload(hook),
    ADDRESS: checkAddress(hook, isAr),
  };

  const flags: HookDealbreaker[] = [];
  for (const item of DEALBREAKERS) {
    if (item.pattern.test(hook)) {
      flags.push({ en: item.en, ar: item.ar });
    }
  }

  const order: HookCheckResult["id"][] = ["LENGTH", "SPECIFICITY", "STAKES", "FRONTLOAD", "ADDRESS"];
  const scores = order.map((k) => checks[k].score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const minScore = Math.min(...scores);
  const overall = clamp(mean * 0.6 + minScore * 0.4 - flags.length * 15);
  const rounded = Math.round(overall * 10) / 10;

  let verdict: HookVerdict = "WEAK";
  if (rounded >= 70 && minScore >= 55 && flags.length === 0) verdict = "STRONG";
  else if (rounded >= 50) verdict = "OK";

  const weakest = order.reduce((best, id) => (checks[id].score < checks[best].score ? id : best), "LENGTH");

  return {
    hook,
    language,
    score: rounded,
    verdict,
    weakest,
    flags,
    checks,
    placeholders: extractPlaceholders(hook),
    formula: classifyReelHook(hook),
    scope: HOOK_FILTER_SCOPE,
  };
}

export function rankReelHooks(
  hooks: string[],
  options: { language?: "en" | "ar" } = {},
): ReelHookScore[] {
  return hooks
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => scoreReelHook(h, options))
    .sort((a, b) => b.score - a.score);
}

const STOPWORDS_EN = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for",
  "with", "that", "this", "it", "is", "are", "was", "were", "be", "been",
  "you", "your", "i", "my", "me", "we", "our", "they", "them", "he", "she",
  "so", "just", "not", "no", "do", "did", "does", "have", "has", "had",
  "will", "can", "at", "as", "by", "from", "out", "up", "off", "one", "all",
  "more", "most", "here", "there", "now", "when", "what", "how",
]);

const STOPWORDS_AR = new Set([
  "في", "من", "على", "إلى", "الى", "عن", "مع", "هذا", "هذه", "هذي", "ذلك",
  "تلك", "التي", "الذي", "اللي", "و", "أو", "او", "ثم", "لكن", "بس", "بل",
  "لا", "ما", "لم", "لن", "إن", "ان", "أن", "كان", "كانت", "هو", "هي", "هم",
  "نحن", "أنتم", "انتم", "كل", "بعد", "قبل", "عند", "هنا", "الآن", "الحين",
  "كم", "كيف", "لماذا", "متى", "بين", "حتى", "أي", "اي", "لكي", "عشان",
].map(normalizeArabicToken));

function loopTokens(text: string): { key: string; display: string }[] {
  const words = countWordsArray(stripPlaceholdersForConcrete(text));
  const out: { key: string; display: string }[] = [];
  for (const w of words) {
    if (ARABIC_CHAR_RE.test(w)) {
      const norm = normalizeArabicToken(w);
      const stem = stripArabicClitics(norm);
      if (stem.length < 2 || STOPWORDS_AR.has(norm) || STOPWORDS_AR.has(stem)) continue;
      out.push({ key: stem, display: w });
    } else {
      let en = w.toLowerCase().replace(/^['’]|['’]$/g, "");
      if (en.length > 4 && en.endsWith("s") && !en.endsWith("ss")) en = en.slice(0, -1);
      if (en.length < 2 || STOPWORDS_EN.has(en)) continue;
      out.push({ key: en, display: w });
    }
  }
  return out;
}

function cleanBeatLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*•]\s+/, "")
    .replace(/^\*{0,2}(?:beat\s*\d+|النبضة\s*\d+|الشريحة\s*\d+|\[?\d+:\d{2}(?:\.\d+)?(?:\s*[-–]\s*\d+:\d{2}(?:\.\d+)?)?\]?)\s*\*{0,2}\s*[:：\-–]?\s*/iu, "")
    .replace(/^\*{0,2}(?:HOOK|STAKE|BODY|PAYOFF|LOOP|CTA|MID)\*{0,2}\s*[:：\-–]\s*/i, "")
    .trim();
}

function splitBeats(raw: string, wps: number): string[] {
  const beats: string[] = [];
  for (const rawLine of raw.replace(/\r\n/g, "\n").split("\n")) {
    const line = cleanBeatLine(rawLine);
    if (!line || /^[-=_]{3,}$/.test(line)) continue;
    const wordsCount = countWordsArray(line).length;
    if (wordsCount === 0) continue;
    if (wordsCount / wps <= MAX_BEAT_SECONDS * 1.5) {
      beats.push(line);
      continue;
    }
    const parts = (line.match(/[^.!?؟]+[.!?؟]*/g) ?? [line]).map((p) => p.trim()).filter(Boolean);
    let buf = "";
    for (const part of parts) {
      const candidate = buf ? `${buf} ${part}` : part;
      if (buf && countWordsArray(candidate).length / wps > MAX_BEAT_SECONDS) {
        beats.push(buf);
        buf = part;
      } else {
        buf = candidate;
      }
    }
    if (buf) beats.push(buf);
  }
  return beats;
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

/**
 * Splits a spoken Reel script into timed beats (~30s target), checking Beat 1 <= 3s,
 * any beat > 4s, abstract runs >= 3 beats, loop echo back to Beat 1, and {{placeholders}}.
 */
export function analyzeReelBeats(
  raw: string,
  options: { wpm?: number; targetSeconds?: number; language?: "en" | "ar" } = {},
): ReelBeatAnalysis | null {
  const hasArabic = options.language === "ar" || ARABIC_CHAR_RE.test(raw);
  const language: "en" | "ar" = hasArabic ? "ar" : "en";
  const wpm = options.wpm && options.wpm > 60 && options.wpm <= 320
    ? options.wpm
    : language === "ar" ? DEFAULT_WPM_AR : DEFAULT_WPM_EN;
  const targetSeconds = options.targetSeconds ?? DEFAULT_TARGET_SECONDS;
  const wps = wpm / 60;

  const beatTexts = splitBeats(raw, wps);
  if (!beatTexts.length) return null;

  const rows: ReelBeatRow[] = [];
  let clock = 0;

  beatTexts.forEach((text, idx) => {
    const words = countWordsArray(text).length;
    const dur = words / wps;
    const concrete = extractConcreteMarkers(text).length;
    const placeholders = extractPlaceholders(text);
    rows.push({
      n: idx + 1,
      start: Math.round(clock * 100) / 100,
      dur: Math.round(dur * 100) / 100,
      timecode: formatTimecode(clock),
      words,
      text,
      concrete,
      placeholders,
      label: "",
      flags_en: [],
      flags_ar: [],
    });
    clock += dur;
  });

  const total = clock;
  for (const r of rows) {
    if (r.n === 1 || r.start + r.dur <= HOOK_WINDOW_SECONDS) r.label = "HOOK";
  }
  const lastRow = rows[rows.length - 1];
  lastRow.label = lastRow.label === "HOOK" ? "HOOK/CTA" : "CTA";
  const half = total / 2;
  for (const r of rows) {
    if (!r.label && r.start <= half && half < r.start + r.dur) r.label = "MID";
  }

  const notesEn: string[] = [];
  const notesAr: string[] = [];

  if (rows[0].dur > HOOK_WINDOW_SECONDS) {
    const maxWords = Math.floor(HOOK_WINDOW_SECONDS * wps);
    rows[0].flags_en.push(`hook runs ${rows[0].dur.toFixed(1)}s (> ${HOOK_WINDOW_SECONDS}s)`);
    rows[0].flags_ar.push(`مدة الخطاف ${rows[0].dur.toFixed(1)} ثانية (> ${HOOK_WINDOW_SECONDS}ث)`);
    notesEn.push(`Beat 1 takes ${rows[0].dur.toFixed(1)}s. Trim to ${maxWords} words or fewer so the hook lands within 3s.`);
    notesAr.push(`الجملة الأولى تستغرق ${rows[0].dur.toFixed(1)} ثانية. اختصروها إلى ${maxWords} كلمات أو أقل ليثبت الخطاف ضمن 3 ثوانٍ.`);
  }

  if (rows[0].concrete === 0) {
    notesEn.push("Beat 1 has no confirmed number, price, or specific name.");
    notesAr.push("الجملة الأولى خالية من رقم أو سعر أو اسم محدد يمكن التحقق منه.");
  }

  const longBeats: number[] = [];
  for (const r of rows) {
    if (r.dur > MAX_BEAT_SECONDS) {
      longBeats.push(r.n);
      r.flags_en.push(`${r.dur.toFixed(1)}s on one beat (> ${MAX_BEAT_SECONDS}s)`);
      r.flags_ar.push(`${r.dur.toFixed(1)} ثانية على لقطة واحدة (> ${MAX_BEAT_SECONDS}ث)`);
    }
    if (r.placeholders.length > 0) {
      r.flags_en.push(`Needs owner fact: ${r.placeholders.join(", ")}`);
      r.flags_ar.push(`يتطلب رقماً من المالك: ${r.placeholders.join("، ")}`);
    }
  }
  if (longBeats.length > 0) {
    notesEn.push(`Beat(s) ${longBeats.join(", ")} exceed ${MAX_BEAT_SECONDS}s. Split the line or cut to a fresh visual frame.`);
    notesAr.push(`النبضات (${longBeats.join("، ")}) تتجاوز ${MAX_BEAT_SECONDS} ثوانٍ. قسّموها أو غيّروا الكادر حتى لا يغادر المشاهد.`);
  }

  let run = 0;
  let runStart: number | null = null;
  for (const r of rows) {
    if (r.concrete === 0) {
      run += 1;
      runStart = runStart ?? r.n;
      if (run === ABSTRACT_RUN_LIMIT) {
        notesEn.push(`Beats ${runStart}–${r.n} have nothing concrete in them. Add a number, name, or price.`);
        notesAr.push(`النبضات ${runStart}–${r.n} متتالية دون أي رقم أو حقيقة ملموسة.`);
      }
    } else {
      run = 0;
      runStart = null;
    }
  }

  const firstToks = loopTokens(rows[0].text);
  const lastKeys = new Set(loopTokens(lastRow.text).map((t) => t.key));
  const echoed: string[] = [];
  const seenEcho = new Set<string>();
  for (const tok of firstToks) {
    if (lastKeys.has(tok.key) && !seenEcho.has(tok.key)) {
      seenEcho.add(tok.key);
      echoed.push(tok.display);
    }
  }
  const loops = echoed.length > 0;
  if (loops) {
    notesEn.push(`Loop ready: the final beat echoes "${echoed.slice(0, 3).join(", ")}" from Beat 1.`);
    notesAr.push(`حلقة إغلاق ناجحة: الجملة الأخيرة تكرر كلمة «${echoed.slice(0, 3).join("، ")}» من الخطاف.`);
  } else {
    notesEn.push("No loop detected: Beat 1 and the final beat share no key word. Echoing a hook word helps replays.");
    notesAr.push("لا توجد حلقة عودة: الجملة الأخيرة لا تعيد أي كلمة من الخطاف.");
  }

  if (targetSeconds > 0) {
    const delta = total - targetSeconds;
    if (Math.abs(delta) <= targetSeconds * 0.12) {
      notesEn.push(`Length is on target (~${total.toFixed(1)}s vs ${targetSeconds}s).`);
      notesAr.push(`المدة مطابقة للهدف (~${total.toFixed(1)} ثانية مقابل ${targetSeconds}ث).`);
    } else if (delta > 0) {
      const cutWords = Math.max(1, Math.round(delta * wps));
      notesEn.push(`${delta.toFixed(1)}s over ${targetSeconds}s target (~${cutWords} words to trim).`);
      notesAr.push(`يزيد بمقدار ${delta.toFixed(1)} ثانية عن الهدف (~${cutWords} كلمة للاختصار).`);
    } else {
      const addWords = Math.max(1, Math.round(-delta * wps));
      notesEn.push(`${(-delta).toFixed(1)}s under ${targetSeconds}s target (~${addWords} words short; tighter is often better).`);
      notesAr.push(`أقصر بمقدار ${(-delta).toFixed(1)} ثانية عن ${targetSeconds}ث (المقاطع المركزة غالباً أفضل).`);
    }
  }

  const allPlaceholders = extractPlaceholders(raw);
  if (allPlaceholders.length > 0) {
    notesEn.push(`Owner inputs required before filming: ${allPlaceholders.join(", ")}.`);
    notesAr.push(`بيانات مطلوبة من المالك قبل التصوير: ${allPlaceholders.join("، ")}.`);
  }

  return {
    language,
    wpm,
    target_seconds: targetSeconds,
    total_seconds: Math.round(total * 10) / 10,
    total_words: rows.reduce((sum, r) => sum + r.words, 0),
    beats: rows,
    loop: { loops, echoed_words: echoed },
    placeholders: allPlaceholders,
    flags_count: rows.reduce((sum, r) => sum + r.flags_en.length, 0),
    notes_en: notesEn,
    notes_ar: notesAr,
  };
}

function splitMarkdownSections(doc: string): { heading: string; level: number; body: string }[] {
  const sections: { heading: string; level: number; lines: string[] }[] = [];
  let current: { heading: string; level: number; lines: string[] } | null = null;

  for (const line of doc.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^\s*(?:\(\d+\)\s*|\d+[.)]\s*)?(#{1,4})\s+(.+?)\s*$/u.exec(line);
    if (m) {
      current = { heading: m[2], level: m[1].length, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections.map((s) => ({ heading: s.heading, level: s.level, body: s.lines.join("\n").trim() }));
}

function selectLanguageSlice(doc: string, language: "en" | "ar"): { slice: string; hasEn: boolean; hasAr: boolean } {
  const normalized = doc.replace(/\r\n/g, "\n");
  const enMarker = /^\s*(?:\(\d+\)\s*)?#{2,3}\s*(?:english(?:\s+(?:version|reel script|copy|draft))?|النسخة الإنجليزية)\b.*$/imu;
  const arMarker = /^\s*(?:\(\d+\)\s*)?#{2,3}\s*(?:arabic(?:\s+(?:version|reel script|copy|draft))?|النسخة العربية)\b.*$/imu;
  const enMatch = enMarker.exec(normalized);
  const arMatch = arMarker.exec(normalized);
  const hasEn = Boolean(enMatch);
  const hasAr = Boolean(arMatch);

  if (enMatch && arMatch) {
    const firstIsEn = enMatch.index < arMatch.index;
    const enStart = enMatch.index;
    const arStart = arMatch.index;
    const enSlice = firstIsEn ? normalized.slice(enStart, arStart).trim() : normalized.slice(enStart).trim();
    const arSlice = firstIsEn ? normalized.slice(arStart).trim() : normalized.slice(arStart, enStart).trim();
    return {
      slice: language === "ar" ? arSlice : enSlice,
      hasEn: true,
      hasAr: true,
    };
  }
  return { slice: normalized, hasEn, hasAr };
}

function cleanFieldValue(text: string): string {
  return text.replace(/^\*{1,2}|\*{1,2}$/g, "").replace(/^["«]|["»]$/g, "").trim();
}

function parseHooksSection(body: string, language: "en" | "ar"): ParsedHookOption[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  const optionStart = /^(?:#{3,4}\s*|\*{0,2})(?:option|hook|الخيار|الخطاف)\s*(?:#|\d|[١-٣])/iu;

  for (const line of body.split("\n")) {
    if (optionStart.test(line.trim()) || /^\s*[1-3]\.\s+\*{0,2}(?:option|formula|#\d|النموذج|الصيغة|الخيار)/iu.test(line)) {
      if (buf.length) blocks.push(buf.join("\n"));
      buf = [line];
    } else if (buf.length || line.trim()) {
      buf.push(line);
    }
  }
  if (buf.length) blocks.push(buf.join("\n"));

  const formulaMap = new Map<number, ReelHookFormula>(REEL_HOOK_FORMULAS.map((f) => [f.id, f]));
  const options: ParsedHookOption[] = [];

  blocks.forEach((block, idx) => {
    const idMatch = /(?:formula|الصيغة|النموذج|#)\s*#?(\d{1,2})\b/iu.exec(block);
    const parsedId = idMatch ? Number(idMatch[1]) : null;
    const formulaObj = parsedId ? formulaMap.get(parsedId) ?? null : null;

    let spoken = "";
    let onScreen = "";
    let why = "";

    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim().replace(/^[-*•]\s*/, "").replace(/\*\*/g, "");
      if (!line) continue;
      if (/^(?:spoken(?:\s+hook|\s+line)?|الخطاف المنطوق|النص المنطوق)\s*[:：]/iu.test(line)) {
        spoken = cleanFieldValue(line.replace(/^[^:：]+[:：]\s*/, ""));
      } else if (/^(?:on[\s-]*screen(?:\s+(?:text|card|line))?|النص على الشاشة|على الشاشة)\s*[:：]/iu.test(line)) {
        onScreen = cleanFieldValue(line.replace(/^[^:：]+[:：]\s*/, ""));
      } else if (/^(?:why(?:\s*\/\s*trap avoided)?|trap avoided|best for|السبب|الفخ الذي تم تجنبه|ملاحظة)\s*[:：]/iu.test(line)) {
        why = cleanFieldValue(line.replace(/^[^:：]+[:：]\s*/, ""));
      } else if (!spoken && !optionStart.test(line) && !/^formula\s*#/i.test(line)) {
        spoken = cleanFieldValue(line);
      }
    }

    if (!spoken) return;
    const scored = scoreReelHook(spoken, { language });
    const formulaId = parsedId ?? scored.formula?.id ?? null;
    const formulaName = formulaObj
      ? (language === "ar" ? `${formulaObj.ar.name} (${formulaObj.name})` : formulaObj.name)
      : (scored.formula ? (language === "ar" ? scored.formula.name_ar : scored.formula.name) : (language === "ar" ? "خطاف مخصص" : "Custom Hook"));

    const onScreenWords = countWordsArray(onScreen).length;
    options.push({
      optionIndex: idx + 1,
      formulaId,
      formulaName,
      spoken,
      onScreen,
      onScreenWords,
      onScreenOk: Boolean(onScreen) && onScreenWords <= MAX_ON_SCREEN_WORDS,
      why,
      scored,
    });
  });

  return options.sort((a, b) => b.scored.score - a.scored.score);
}

function parseOnScreenSection(body: string): ParsedOnScreenCard[] {
  const cards: ParsedOnScreenCard[] = [];
  for (const rawLine of body.split("\n")) {
    const trimmed = toLatinDigits(rawLine.trim()).replace(/^[-*•]\s*/, "").replace(/\*\*/g, "");
    if (!trimmed || /^safe zone|المنطقة الآمنة|ملاحظة/iu.test(trimmed)) continue;
    const tcMatch = /^(?:\[?(\d+:\d{2}(?:\.\d+)?(?:\s*[-–]\s*\d+:\d{2}(?:\.\d+)?)?)\]?|(?:card|frame|شريحة|إطار|بطاقة)\s*\d+\s*\(?([^)]*)\)?)\s*[:：\-–]?\s*(.+)$/iu.exec(trimmed);
    const timecode = tcMatch ? (tcMatch[1] || tcMatch[2] || `${cards.length + 1}`).trim() : `${cards.length + 1}`;
    const text = cleanFieldValue(tcMatch ? tcMatch[3] : trimmed);
    if (!text) continue;
    const words = countWordsArray(text).length;
    cards.push({
      index: cards.length + 1,
      timecode,
      text,
      words,
      withinLimit: words > 0 && words <= MAX_ON_SCREEN_WORDS,
    });
  }
  return cards;
}

function stripScriptMeta(body: string): { note: string; spokenLines: string } {
  const noteLines: string[] = [];
  const spoken: string[] = [];
  for (const rawLine of body.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const unstyled = trimmed.replace(/^[-*•]\s*/, "").replace(/\*\*/g, "").trim();
    if (/^(?:spoken\s*script|script|النص\s*المنطوق|السكربت)\s*[:：]?\s*$/iu.test(unstyled)) {
      continue;
    }
    if (/^(?:chosen hook|selected hook|الخطاف المختار|سبب الاختيار)\s*[:：]/iu.test(unstyled)) {
      noteLines.push(unstyled);
      continue;
    }
    if (/^(?:target|length|wpm|المدة المستهدفة)\s*[:：]/iu.test(unstyled)) {
      noteLines.push(unstyled);
      continue;
    }
    spoken.push(rawLine);
  }
  return { note: noteLines.join(" · "), spokenLines: spoken.join("\n") };
}

/**
 * Parses Gemini's structured Reel script markdown document into typed sections,
 * runs the weak-hook filter on all 3 hooks, computes the timed beat sheet,
 * checks on-screen text word caps, extracts the caption, and flags {{placeholders}}.
 */
export function parseReelScriptDocument(
  document: string,
  options: { language?: "en" | "ar" } = {},
): ParsedReelScript {
  const doc = (document ?? "").trim();
  const preferredLanguage: "en" | "ar" = options.language === "ar"
    ? "ar"
    : options.language === "en"
      ? "en"
      : (ARABIC_CHAR_RE.test(doc) ? "ar" : "en");

  const { slice, hasEn, hasAr } = selectLanguageSlice(doc, preferredLanguage);
  const effectiveLang: "en" | "ar" = ARABIC_CHAR_RE.test(slice) && preferredLanguage === "ar" ? "ar" : (ARABIC_CHAR_RE.test(slice) && !hasEn ? "ar" : preferredLanguage);
  const sections = splitMarkdownSections(slice);

  const hooksSection = sections.find((s) => /hook options|خيارات الخطاف|خيارات الهوك/iu.test(s.heading));
  const scriptSection = sections.find((s) => /chosen reel script|spoken script|reel script|النص المنطوق|نص الريلز|السكربت المختار/iu.test(s.heading));
  const onScreenSection = sections.find((s) => /on[\s-]*screen text|النص على الشاشة|نصوص الشاشة/iu.test(s.heading));
  const captionSection = sections.find((s) => /instagram caption|caption|وصف إنستغرام|وصف الريلز|الكابشن/iu.test(s.heading));

  const hooks = hooksSection ? parseHooksSection(hooksSection.body, effectiveLang) : [];
  const { note, spokenLines } = scriptSection ? stripScriptMeta(scriptSection.body) : { note: "", spokenLines: "" };
  const beatSheet = spokenLines ? analyzeReelBeats(spokenLines, { language: effectiveLang, targetSeconds: DEFAULT_TARGET_SECONDS }) : null;
  const onScreenCards = onScreenSection ? parseOnScreenSection(onScreenSection.body) : [];
  const rawCaption = captionSection
    ? captionSection.body
        .split(/\n-{3,}\n/)[0]
        .replace(/^\s*(?:caption|وصف|الكابشن)\s*[:：]\s*/iu, "")
        .trim()
    : "";

  return {
    language: effectiveLang,
    hasEnglishSection: hasEn,
    hasArabicSection: hasAr,
    hooks,
    chosenNote: note,
    spokenScript: spokenLines.trim(),
    beatSheet,
    onScreenCards,
    caption: rawCaption,
    placeholders: extractPlaceholders(doc),
  };
}
