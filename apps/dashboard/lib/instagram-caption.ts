export const INSTAGRAM_CAPTION_LIMIT = 2200;
export const INSTAGRAM_VISIBLE_CHARS = 125;
export const INSTAGRAM_HASHTAG_LIMIT = 5;

export type CaptionCheckStatus = "PASS" | "WARN" | "FAIL";
export type CaptionVerdict = "READY" | "REVIEW" | "FIX";

export interface CaptionCheck {
  id:
    | "LENGTH"
    | "FIRST_LINE"
    | "HOOK_IS_CONCRETE"
    | "HASHTAGS"
    | "TAG_PLACEMENT"
    | "LINKS"
    | "ONE_ASK"
    | "EMOJI"
    | "SEARCH_TERMS";
  label_en: string;
  label_ar: string;
  status: CaptionCheckStatus;
  detail_en: string;
  detail_ar: string;
}

export interface CaptionAnalysis {
  characters: number;
  visible_characters: number;
  limit: number;
  truncate_at: number;
  visible: string;
  hidden: string;
  truncated: boolean;
  first_line_chars: number;
  hashtags: string[];
  filler_hashtags: string[];
  mentions: string[];
  links: string[];
  emoji_count: number;
  emoji_density: number;
  asks: { key: string; label_en: string; label_ar: string }[];
  keywords: {
    requested: string[];
    found: string[];
    missing: string[];
    in_window: string[];
  };
  checks: CaptionCheck[];
  verdict: CaptionVerdict;
}

const HASHTAG_RE = /(?:^|\s)(#[\p{L}\p{N}_]+)/gu;
const MENTION_RE = /(?:^|\s)(@[A-Za-z0-9_.]+)/g;
const LINK_RE = /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|co|io|net|org|ai|app|online)\/\S*/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

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

function normalizeSearchText(text: string): string {
  return toLatinDigits(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/gu, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

const CONCRETE_EN_RE = /\$\s?\d[\d,]*|\b\d[\d,.]*\b/g;

function countConcreteInWindow(windowText: string): number {
  const cleaned = windowText.replace(/\{\{([^}]+)\}\}/g, " ");
  const latinized = toLatinDigits(cleaned);
  const nums = latinized.match(CONCRETE_EN_RE) ?? [];
  const words = cleaned.match(/[\p{L}\p{N}$%]+/gu) ?? [];
  const propers = new Set<string>();
  words.forEach((tok, idx) => {
    if (idx > 0 && /^[A-Z][a-z]{2,}$/.test(tok)) propers.add(tok);
  });
  return nums.length + propers.size;
}

const FILLER_TAGS = new Set([
  "#viral", "#fyp", "#explore", "#explorepage", "#foryou", "#foryoupage",
  "#trending", "#instagood", "#love", "#follow", "#like4like", "#reels",
  "#reelsinstagram", "#viralreels", "#instadaily",
  "#اكسبلور", "#إكسبلور", "#اكسبلورر", "#ترند", "#فيرال", "#فوريو",
  "#ريلز", "#انستقرام", "#إنستغرام", "#لايك", "#فولو", "#تفاعل",
]);

const ASK_PATTERNS: { key: string; pattern: RegExp; label_en: string; label_ar: string }[] = [
  {
    key: "comment",
    pattern: /\bcomment\b(?:\s+(?:the\s+word\s+)?["«]?[A-Z0-9\p{L}]{2,}|[^.!?\n]{0,24}\bbelow\b)|(?:علّقوا|علقوا|اكتبوا|اكتب)\s+(?:كلمة|في التعليقات|لنا\s+كلمة|بـ)/iu,
    label_en: "comment",
    label_ar: "تعليق",
  },
  {
    key: "dm",
    pattern: /\b(?:dm|message|send)\s+(?:me|us)\b|\bsend us a message\b|(?:راسلونا|أرسلوا لنا رسالة|ارسلوا لنا|تواصلوا معنا(?:\s+على|\s+عبر)?\s+الخاص|في الخاص)/iu,
    label_en: "DM / message",
    label_ar: "رسالة على الخاص",
  },
  {
    key: "save",
    pattern: /\bsave (?:this|it|for later)\b|(?:احفظوا)\s+(?:هذا|المنشور|المقطع|الريلز|البوست)/iu,
    label_en: "save post",
    label_ar: "حفظ المنشور",
  },
  {
    key: "share",
    pattern: /\bshare (?:this|it)\b|\bsend this to\b|(?:شاركوا)\s+(?:هذا|المقطع|المنشور)|(?:أرسلوا هذا|ابعثوه)/iu,
    label_en: "share",
    label_ar: "مشاركة",
  },
  {
    key: "follow",
    pattern: /\bfollow (?:me|us|for)\b|(?:تابعونا|تابعوا الحساب)/iu,
    label_en: "follow",
    label_ar: "متابعة",
  },
  {
    key: "link_in_bio",
    pattern: /\blink in (?:my |our )?bio\b|(?:الرابط في البايو|رابط البايو|في البايو)/iu,
    label_en: "link in bio",
    label_ar: "الرابط في البايو",
  },
  {
    key: "swipe_tap",
    pattern: /\b(?:swipe|tap) (?:through|left|right|for|to|the link)\b|(?:اسحبوا|اضغطوا على)/iu,
    label_en: "swipe / tap",
    label_ar: "سحب / ضغط",
  },
  {
    key: "question",
    pattern: /\b(?:tell me|tell us|what would you|which one)\b|(?:أخبرونا|شاركونا رأيكم|أيّها تفضّلون|شرايكم)/iu,
    label_en: "answer a question",
    label_ar: "إجابة في التعليقات",
  },
  {
    key: "book_shop",
    pattern: /\b(?:book|shop|order|register|enroll)\s+(?:now|today|your)\b|(?:احجزوا|تسوّقوا|تسوقوا|اطلبوا|سجّلوا|سجلوا)\s+(?:الآن|اليوم|مقعدكم|طلبكم)/iu,
    label_en: "book / order / register",
    label_ar: "حجز / طلب / تسجيل",
  },
];

function codepointSlice(text: string, limit: number): { visible: string; hidden: string; totalChars: number; visibleChars: number } {
  const chars = Array.from(text);
  const totalChars = chars.length;
  if (totalChars <= limit) {
    return { visible: text, hidden: "", totalChars, visibleChars: totalChars };
  }
  return {
    visible: chars.slice(0, limit).join(""),
    hidden: chars.slice(limit).join(""),
    totalChars,
    visibleChars: limit,
  };
}

/**
 * Lints an Instagram caption (EN or AR) and slices the exact 125-character
 * window visible in the Instagram feed before "... more" / "... المزيد".
 */
export function analyzeInstagramCaption(
  text: string,
  options: { truncateAt?: number; keywords?: string[] } = {},
): CaptionAnalysis {
  const cut = Math.max(40, Math.min(200, Math.floor(options.truncateAt ?? INSTAGRAM_VISIBLE_CHARS)));
  const stripped = (text ?? "").trim();
  const { visible, hidden, totalChars, visibleChars } = codepointSlice(stripped, cut);
  const truncated = totalChars > cut;

  const lines = stripped ? stripped.split("\n") : [];
  const firstLine = lines[0]?.trim() ?? "";
  const firstLineChars = Array.from(firstLine).length;

  const tags = [...stripped.matchAll(HASHTAG_RE)].map((m) => m[1]);
  const fillerTags = tags.filter((t) => FILLER_TAGS.has(t.toLowerCase()));
  const mentions = [...stripped.matchAll(MENTION_RE)].map((m) => m[1]);
  const links = stripped.match(LINK_RE) ?? [];
  const emojis = stripped.match(EMOJI_RE) ?? [];

  const asks: { key: string; label_en: string; label_ar: string }[] = [];
  for (const ask of ASK_PATTERNS) {
    if (ask.pattern.test(stripped)) {
      asks.push({ key: ask.key, label_en: ask.label_en, label_ar: ask.label_ar });
    }
  }

  const windowConcreteCount = countConcreteInWindow(visible);
  const checks: CaptionCheck[] = [];

  // 1. TOTAL LENGTH vs 2200
  checks.push({
    id: "LENGTH",
    label_en: "Length limit",
    label_ar: "حد الطول",
    status: totalChars > INSTAGRAM_CAPTION_LIMIT ? "FAIL" : "PASS",
    detail_en: totalChars > INSTAGRAM_CAPTION_LIMIT
      ? `${totalChars} / ${INSTAGRAM_CAPTION_LIMIT} chars (${totalChars - INSTAGRAM_CAPTION_LIMIT} over Instagram limit)`
      : `${totalChars} / ${INSTAGRAM_CAPTION_LIMIT} characters`,
    detail_ar: totalChars > INSTAGRAM_CAPTION_LIMIT
      ? `${totalChars} / ${INSTAGRAM_CAPTION_LIMIT} حرفاً (تجاوز الحد بمقدار ${totalChars - INSTAGRAM_CAPTION_LIMIT})`
      : `${totalChars} / ${INSTAGRAM_CAPTION_LIMIT} حرفاً`,
  });

  // 2. FIRST LINE at 125 chars
  if (!firstLine) {
    checks.push({
      id: "FIRST_LINE",
      label_en: "First line (125-char cut)",
      label_ar: "السطر الأول (حد 125 حرفاً)",
      status: "FAIL",
      detail_en: "Caption is empty or opens on a blank line.",
      detail_ar: "الوصف فارغ أو يبدأ بسطر فارغ.",
    });
  } else if (firstLine.startsWith("#") || firstLine.startsWith("@")) {
    checks.push({
      id: "FIRST_LINE",
      label_en: "First line (125-char cut)",
      label_ar: "السطر الأول (حد 125 حرفاً)",
      status: "FAIL",
      detail_en: "Opens on a hashtag or mention instead of a hook or value sentence.",
      detail_ar: "يبدأ بهاشتاق أو إشارة بدلاً من جملة افتتاحية واضحة.",
    });
  } else if (firstLineChars > cut) {
    checks.push({
      id: "FIRST_LINE",
      label_en: "First line (125-char cut)",
      label_ar: "السطر الأول (حد 125 حرفاً)",
      status: "WARN",
      detail_en: `Line 1 is ${firstLineChars} chars and gets cut mid-thought at ${cut} chars. Shorten unless the break is intentional.`,
      detail_ar: `السطر الأول ${firstLineChars} حرفاً وسينقطع عند الحرف ${cut} قبل «المزيد». اختصروه إذا كان المعنى لم يكتمل.`,
    });
  } else {
    checks.push({
      id: "FIRST_LINE",
      label_en: "First line (125-char cut)",
      label_ar: "السطر الأول (حد 125 حرفاً)",
      status: "PASS",
      detail_en: `${firstLineChars} chars — lands whole before “... more”.`,
      detail_ar: `${firstLineChars} حرفاً — يظهر كاملاً قبل «... المزيد».`,
    });
  }

  // 3. CONCRETE MARKER IN VISIBLE WINDOW
  checks.push({
    id: "HOOK_IS_CONCRETE",
    label_en: "Concrete detail in 125 chars",
    label_ar: "مؤشر ملموس قبل القطع",
    status: windowConcreteCount > 0 ? "PASS" : "WARN",
    detail_en: windowConcreteCount > 0
      ? `${windowConcreteCount} number(s) or proper name(s) in the visible window.`
      : "No number or proper name in the first 125 characters.",
    detail_ar: windowConcreteCount > 0
      ? `${windowConcreteCount} رقم أو اسم محدد ظاهر قبل القطع.`
      : "لا يوجد رقم أو اسم محدد في أول 125 حرفاً.",
  });

  // 4. HASHTAGS CAP 5 (Dec 18, 2025 Instagram cap)
  if (tags.length > INSTAGRAM_HASHTAG_LIMIT) {
    checks.push({
      id: "HASHTAGS",
      label_en: "Hashtags (max 5)",
      label_ar: "الهاشتاقات (الحد 5)",
      status: "FAIL",
      detail_en: `${tags.length} hashtags — exceeds Instagram's cap of ${INSTAGRAM_HASHTAG_LIMIT} per post.`,
      detail_ar: `${tags.length} هاشتاقات — يتجاوز الحد الأقصى في إنستغرام وهو ${INSTAGRAM_HASHTAG_LIMIT} لكل منشور.`,
    });
  } else if (fillerTags.length > 0) {
    checks.push({
      id: "HASHTAGS",
      label_en: "Hashtags (max 5)",
      label_ar: "الهاشتاقات (الحد 5)",
      status: "WARN",
      detail_en: `${tags.length} / ${INSTAGRAM_HASHTAG_LIMIT} tags, but ${fillerTags.length} generic filler (${fillerTags.slice(0, 3).join(", ")}). Replace with topic tags.`,
      detail_ar: `${tags.length} / ${INSTAGRAM_HASHTAG_LIMIT} هاشتاقات، لكن ${fillerTags.length} منها عام غير مفيد (${fillerTags.slice(0, 3).join("، ")}).`,
    });
  } else {
    checks.push({
      id: "HASHTAGS",
      label_en: "Hashtags (max 5)",
      label_ar: "الهاشتاقات (الحد 5)",
      status: "PASS",
      detail_en: tags.length
        ? `${tags.length} / ${INSTAGRAM_HASHTAG_LIMIT} specific tag(s): ${tags.join(" ")}`
        : "0 tags (within the 5-tag cap).",
      detail_ar: tags.length
        ? `${tags.length} / ${INSTAGRAM_HASHTAG_LIMIT} هاشتاقات محددة: ${tags.join(" ")}`
        : "0 هاشتاقات (ضمن حد الـ 5).",
    });
  }

  // 5. TAG PLACEMENT
  const tagInWindow = tags.some((t) => visible.includes(t));
  checks.push({
    id: "TAG_PLACEMENT",
    label_en: "Hashtag placement",
    label_ar: "موضع الهاشتاقات",
    status: !tags.length || !tagInWindow ? "PASS" : "WARN",
    detail_en: !tags.length
      ? "No hashtags to place."
      : tagInWindow
        ? "A hashtag sits inside the first 125 characters, spending feed space on a label."
        : "Hashtags sit below the 125-char fold.",
    detail_ar: !tags.length
      ? "لا توجد هاشتاقات."
      : tagInWindow
        ? "يظهر هاشتاق داخل أول 125 حرفاً؛ الأفضل وضعها في نهاية الوصف."
        : "الهاشتاقات موضوعة أسفل الطي بعد أول 125 حرفاً.",
  });

  // 6. DEAD LINKS
  checks.push({
    id: "LINKS",
    label_en: "No dead links",
    label_ar: "خلو الوصف من الروابط",
    status: links.length ? "WARN" : "PASS",
    detail_en: links.length
      ? `${links.length} URL(s) in caption — Instagram captions are not clickable; point to bio or DM.`
      : "No unclickable URLs in body.",
    detail_ar: links.length
      ? `${links.length} رابط في النص — روابط الوصف غير قابلة للنقر في إنستغرام؛ وجّهوا للبايو أو الخاص.`
      : "لا توجد روابط غير قابلة للنقر.",
  });

  // 7. ONE CALL TO ACTION
  if (asks.length === 1) {
    checks.push({
      id: "ONE_ASK",
      label_en: "One call to action",
      label_ar: "دعوة واحدة واضحة",
      status: "PASS",
      detail_en: `One clear ask detected (${asks[0].label_en}).`,
      detail_ar: `دعوة واحدة واضحة (${asks[0].label_ar}).`,
    });
  } else if (asks.length === 0) {
    checks.push({
      id: "ONE_ASK",
      label_en: "One call to action",
      label_ar: "دعوة واحدة واضحة",
      status: "WARN",
      detail_en: "No clear call to action detected. Pick one: comment a keyword, DM, save, or follow.",
      detail_ar: "لم تُرصد دعوة صريحة لاتخاذ إجراء. أضيفوا طلباً واحداً (تعليق، رسالة، أو حفظ).",
    });
  } else {
    checks.push({
      id: "ONE_ASK",
      label_en: "One call to action",
      label_ar: "دعوة واحدة واضحة",
      status: "WARN",
      detail_en: `${asks.length} competing asks (${asks.map((a) => a.label_en).join(", ")}). Keep one primary CTA.`,
      detail_ar: `${asks.length} طلبات متزاحمة (${asks.map((a) => a.label_ar).join("، ")}). اكتفوا بدعوة واحدة.`,
    });
  }

  // 8. EMOJI DENSITY
  const density = Math.round((emojis.length * 100 / Math.max(totalChars, 1)) * 10) / 10;
  checks.push({
    id: "EMOJI",
    label_en: "Emoji density",
    label_ar: "كثافة الإيموجي",
    status: density > 4 ? "WARN" : "PASS",
    detail_en: density > 4
      ? `${emojis.length} emoji (${density}/100 chars > 4) — reads as visual clutter.`
      : `${emojis.length} emoji (${density} per 100 characters).`,
    detail_ar: density > 4
      ? `${emojis.length} إيموجي (${density} لكل 100 حرف > 4) — كثافة زائدة.`
      : `${emojis.length} إيموجي (${density} لكل 100 حرف).`,
  });

  // 9. SEARCH TERMS
  const requested = (options.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  let found: string[] = [];
  let missing: string[] = [];
  let inWindow: string[] = [];

  if (requested.length > 0) {
    const normAll = normalizeSearchText(stripped);
    const normWin = normalizeSearchText(visible);
    found = requested.filter((k) => normAll.includes(normalizeSearchText(k)));
    missing = requested.filter((k) => !normAll.includes(normalizeSearchText(k)));
    inWindow = found.filter((k) => normWin.includes(normalizeSearchText(k)));
    const status: CaptionCheckStatus = missing.length === 0 ? "PASS" : found.length > 0 ? "WARN" : "FAIL";
    checks.push({
      id: "SEARCH_TERMS",
      label_en: "Search terms",
      label_ar: "كلمات البحث",
      status,
      detail_en: `${found.length}/${requested.length} present${found.length ? `, ${inWindow.length} in 125-char window` : ""}${missing.length ? `. Missing: ${missing.join(", ")}` : ""}.`,
      detail_ar: `تم العثور على ${found.length} من ${requested.length}${found.length ? ` (${inWindow.length} ضمن أول 125 حرفاً)` : ""}${missing.length ? `. مفقود: ${missing.join("، ")}` : ""}.`,
    });
  }

  const fails = checks.filter((c) => c.status === "FAIL").length;
  const warns = checks.filter((c) => c.status === "WARN").length;
  const verdict: CaptionVerdict = fails > 0 ? "FIX" : warns > 0 ? "REVIEW" : "READY";

  return {
    characters: totalChars,
    visible_characters: visibleChars,
    limit: INSTAGRAM_CAPTION_LIMIT,
    truncate_at: cut,
    visible,
    hidden,
    truncated,
    first_line_chars: firstLineChars,
    hashtags: tags,
    filler_hashtags: fillerTags,
    mentions,
    links,
    emoji_count: emojis.length,
    emoji_density: density,
    asks,
    keywords: { requested, found, missing, in_window: inWindow },
    checks,
    verdict,
  };
}

export interface ExtractedPostCaption {
  title: string;
  caption_en: string;
  caption_ar: string;
}

/**
 * Extracts formatted Instagram captions for each drafted post in a standard
 * content_creator social_posts markdown document so the 125-char check can
 * inspect both EN and AR captions cleanly.
 */
export function extractCaptionsFromSocialDraft(document: string): ExtractedPostCaption[] {
  if (!document || typeof document !== "string") return [];
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of document.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^\s*#{1,3}\s+(.+)$/u.exec(line);
    if (h && /(?:post|draft|منشور|مسودة)\s*\d*/iu.test(h[1]) && !/\b(?:posts|drafts)\b|مسودات|منشورات/iu.test(h[1])) {
      current = { title: h[1].replace(/\*\*/g, "").trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (h && current && (line.startsWith("## ") || line.startsWith("# "))) {
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }

  const results: ExtractedPostCaption[] = [];
  const skipLine = /^\s*[*\-•]?\s*\*{0,2}(?:channel|platform|format|visual\s*(?:brief|direction)|photo\s*brief|image\s*brief|القناة|المنصة|توصيف بصري|الوصف البصري|التنسيق)\s*\*{0,2}\s*[:：]/iu;
  const langLabelPrefix = /^\s*[*\-•]?\s*\*{0,2}\s*((?:modern standard |levantine |gulf |khaleeji |saudi |egyptian |white )?arabic(?:\s*\([^)]*\))?|english(?:\s*\([^)]*\))?|النسخة العربية|النص العربي|النسخة الإنجليزية)\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(.*)$/iu;
  const fieldPrefix = /^\s*[*\-•]?\s*\*{0,2}(?:opening|headline|hook|body|caption|text|cta|call to action|hashtags?|الافتتاحية|العنوان|النص|المتن|المحتوى|نداء الإجراء|دعوة لاتخاذ إجراء|الهاشتاقات|هاشتاقات)\s*(?:\(([^)]*)\))?\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*/iu;

  for (const sec of sections.slice(0, 3)) {
    const enParts: string[] = [];
    const arParts: string[] = [];
    let bucket: "en" | "ar" | "auto" | "skip" = "auto";

    for (const rawLine of sec.lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || /^[-=_]{3,}$/.test(trimmed)) continue;
      if (/^#{3,4}\s*(?:english|النسخة الإنجليزية)/iu.test(trimmed)) { bucket = "en"; continue; }
      if (/^#{3,4}\s*(?:arabic|النسخة العربية)/iu.test(trimmed)) { bucket = "ar"; continue; }
      if (/^#{3,4}\s*(?:visual|photo|image|توصيف)/iu.test(trimmed)) { bucket = "skip"; continue; }
      if (/^#{3,4}\s*/.test(trimmed)) { bucket = "auto"; continue; }
      if (bucket === "skip" || skipLine.test(trimmed)) continue;

      const langMatch = langLabelPrefix.exec(trimmed);
      if (langMatch) {
        const isArLabel = /arabic|عربي|عربية/iu.test(langMatch[1]);
        const rest = langMatch[2].replace(/\*\*/g, "").trim();
        if (rest) {
          if (isArLabel) arParts.push(rest);
          else enParts.push(rest);
        }
        continue;
      }

      const fieldMatch = fieldPrefix.exec(trimmed);
      const qualifier = fieldMatch?.[1] ?? "";
      const cleaned = trimmed.replace(fieldPrefix, "").replace(/\*\*/g, "").trim();
      if (!cleaned) continue;
      if (/arabic|عربي|msa|gulf|saudi|levant|egypt/iu.test(qualifier)) arParts.push(cleaned);
      else if (/english/iu.test(qualifier)) enParts.push(cleaned);
      else if (bucket === "en") enParts.push(cleaned);
      else if (bucket === "ar") arParts.push(cleaned);
      else if (/[\u0600-\u06ff]/u.test(cleaned)) arParts.push(cleaned);
      else enParts.push(cleaned);
    }

    if (enParts.length || arParts.length) {
      results.push({
        title: sec.title,
        caption_en: enParts.join("\n\n"),
        caption_ar: arParts.join("\n\n"),
      });
    }
  }
  return results;
}
