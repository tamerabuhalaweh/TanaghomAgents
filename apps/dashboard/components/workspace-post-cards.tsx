"use client";

import { Download, ExternalLink, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { useLocale } from "@/lib/client/use-locale";

export interface WorkspaceBrandKit {
  name?: string | null;
  brand_name?: string | null;
  colors?: Record<string, unknown> | null;
  arabic_font?: string | null;
  latin_font?: string | null;
  cta?: Record<string, unknown> | string | null;
  tone?: string | null;
}

export interface SocialPostCard {
  headline: string;
  body: string;
  cta: string;
  // Hashtags belong to the post, never to the call-to-action field.
  hashtags?: string;
}

const COLOR = /^#[0-9a-f]{3,8}$/i;

function color(value: unknown, fallback: string) {
  return typeof value === "string" && COLOR.test(value.trim()) ? value.trim() : fallback;
}

function palette(kit: WorkspaceBrandKit | null) {
  const colors = (kit?.colors ?? {}) as Record<string, unknown>;
  return {
    primary: color(colors.primary, "#0F3D3E"),
    accent: color(colors.accent, "#C6A15B"),
    background: color(colors.background, "#FFFFFF"),
  };
}

function brandCta(kit: WorkspaceBrandKit | null) {
  if (typeof kit?.cta === "string") return kit.cta.trim();
  const cta = kit?.cta as Record<string, unknown> | undefined;
  const primary = cta?.primary ?? cta?.label ?? cta?.text;
  return typeof primary === "string" ? primary.trim() : "";
}

function clean(value: string) {
  return value
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[*+•-]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^[*_\s]+|[*_\s]+$/g, "")
    .trim();
}

const CTA_PATTERN = /\b(cta|call to action|book|register|enroll|sign up|order|learn more|shop now)\b|نداء الإجراء|احجز|سجّل|سجل الآن|اطلب|اشترك|تعرّف|جرّب الآن|اطلب الآن/iu;

// A Missing Information notice (or an explicit-assumptions list) is a decision
// record, never a social post. Rendering it as a card shipped internal policy
// text into customer-facing artwork, so these blocks are dropped outright.
const NON_POST_BLOCK = /missing information|missing decisions|open items|معلومات ناقصة|ملاحظة المعلومات|قرارات ناقصة|بنود مفتوحة|explicit decisions|assumptions|الافتراضات/i;

// Generated drafts label their own parts ("Opening (Arabic):", "CTA:",
// "نداء الإجراء:"). Those labels belong to the document structure, not the
// card typography.
const STRUCTURAL_PREFIX = /^(?:opening|headline|hook|body|caption|cta|cta button|call to action|channel|platform|format|visual brief|visual direction|photo brief|image brief|english copy|arabic copy|english version|arabic version|english|arabic|الافتتاحية|العنوان|النص|المتن|المحتوى|نداء الإجراء|دعوة لاتخاذ إجراء|دعوة إلى اتخاذ إجراء|القناة|المنصة|توصيف بصري|الوصف البصري|التنسيق|النسخة العربية|النسخة الإنجليزية|النص العربي|النص الإنجليزي)\s*(?:\((?:[^)]{0,40})\))?\s*[:：\-–]\s*/iu;

// A visual brief or format spec describes the artwork; it is not post copy.
const NON_POST_HEADLINE = /^(?:visual|photo|image)\s*(?:brief|direction|format)$|^(?:format|channel|platform|visual brief|visual direction|photo brief)$|توصيف بصري|تصور بصري|الوصف البصري|توصيف الوسائط|التنسيق/iu;

// Non-copy metadata prefixes that must never land in a card CTA or copy field.
const DISALLOWED_CTA = /^(?:visual|photo|image)\s*(?:brief|direction|format)\b|^(?:channel|platform|format)\s*[:：]|توصيف بصري|تصور بصري|الوصف البصري|^(?:hashtags?|الهاشتاقات|هاشتاقات)\b|(?:^|\s)#[^\s#]+/iu;
const SECTION_LANGUAGE = /^\s*(?:#{3,6}\s*|\*{1,2})?\s*(?:(english(?:\s+(?:copy|version|text))?)|((?:modern standard |levantine |gulf |khaleeji |saudi |egyptian |white )?arabic(?:\s+(?:copy|version|text))?|النسخة العربية|النص العربي))(?:\s*\([^)]*\))?\s*\*{0,2}\s*[:：]?\s*$/iu;
const SKIP_META_LINE = /^\s*[*\-•]?\s*\*{0,2}(?:channel|platform|visual\s*(?:brief|direction)|(?:photo|image)\s*brief|format|القناة|المنصة|توصيف بصري|تصور بصري|الوصف البصري|التنسيق)\s*(?:\([^)]*\))?\s*\*{0,2}\s*[:：]/iu;

export function stripStructuralPrefix(line: string) {
  let value = line;
  for (let index = 0; index < 4; index += 1) {
    const next = value
      .replace(STRUCTURAL_PREFIX, "")
      .replace(/^(?:english copy|arabic copy|english version|arabic version|النسخة العربية|النسخة الإنجليزية)\s*(?:\([^)]*\))?\s+/iu, "")
      .trim();
    if (next === value || !next) break;
    value = next;
  }
  return value;
}

function sanitizeCardField(value: string) {
  const cleaned = stripStructuralPrefix(clean(value || ""))
    .replace(/\s+(?:visual\s*brief|photo\s*brief|توصيف\s*بصري)\s*[:：][\s\S]*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function sanitizeCta(candidate: string, fallbackCta: string) {
  const raw = clean(candidate || "");
  if (!raw || DISALLOWED_CTA.test(raw) || NON_POST_HEADLINE.test(raw)) {
    return sanitizeCardField(fallbackCta);
  }
  const value = sanitizeCardField(raw);
  if (!value || DISALLOWED_CTA.test(value) || NON_POST_HEADLINE.test(value)) {
    return sanitizeCardField(fallbackCta);
  }
  return value;
}

/** Cuts text at a sentence or word boundary so a card never ends mid-word. */
export function completeText(text: string, limit: number) {
  const value = (text || "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  const slice = value.slice(0, limit);
  const boundary = Math.max(...[". ", "؟ ", "! ", "… "].map((token) => slice.lastIndexOf(token)));
  if (boundary >= Math.floor(limit * 0.4)) return slice.slice(0, boundary + 1).trim();
  const word = slice.lastIndexOf(" ");
  return `${(word > 0 ? slice.slice(0, word) : slice).replace(/[،,؛;:.\-–]+$/, "").trim()}…`;
}

// Generated drafts label their own parts ("**Hook (English):**", "**Body
// (Levantine Arabic):**"). Reading those labels produces an accurate card
// instead of guessing at the first long line.
const FIELD_LINE = /^\s*[*\-•]?\s*\*{0,2}(opening|headline|hook|body|caption|text|cta|cta button|call to action|hashtags|visual direction|visual brief|photo brief|image brief|channel|platform|format|الافتتاحية|العنوان|النص|المتن|المحتوى|محتوى|نداء الإجراء|دعوة لاتخاذ إجراء|دعوة إلى اتخاذ إجراء|الهاشتاقات|هاشتاقات|توصيف بصري|القناة|المنصة)\s*(?:\(([^)]*)\))?\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(.*)$/iu;
const HASHTAG_LABEL = /^\s*[*\-•]?\s*\*{0,2}(?:hashtags?|الهاشتاقات|هاشتاقات)\s*\*{0,2}\s*[:：]\s*(.+)$/iu;
const HASHTAG_HEADING = /^(?:hashtags?|الهاشتاقات|هاشتاقات)\s*[:：]/iu;
const POST_SECTION = /^\s*#{1,4}\s*.*(?:post|منشور)/iu;
const ARABIC_QUALIFIER = /arabic|عربي|عربية|شامي|خليجي|سعودي|مصري|msa|فصحى/u;
const IGNORED_FIELD_LABELS = new Set(["visual direction", "visual brief", "photo brief", "image brief", "channel", "platform", "format", "توصيف بصري", "القناة", "المنصة"]);

type LabelledField = { label: string; qualifier: string; text: string };

function labelledFields(text: string): LabelledField[] {
  const found: LabelledField[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let sectionLang = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const langHeading = SECTION_LANGUAGE.exec(line);
    if (langHeading) {
      sectionLang = langHeading[1] ? "english" : "arabic";
      continue;
    }
    const match = FIELD_LINE.exec(line);
    if (!match) continue;
    const label = match[1].toLowerCase();
    if (IGNORED_FIELD_LABELS.has(label)) continue;
    const raw = match[3];
    const explicitQualifier = (match[2] || "").toLowerCase();
    const baseQualifier = [sectionLang, explicitQualifier].filter(Boolean).join(" ").trim();
    const isHashtag = label === "hashtags" || label === "الهاشتاقات" || label === "هاشتاقات";

    // Generated drafts often put the label on its own line, followed either by
    // nested language bullets ("* **English:** …" / "* **Arabic (MSA):** …") or
    // directly by the sentence on the next line ("**الافتتاحية (Hook):**").
    if (!raw.trim()) {
      let cursor = index + 1;
      let consumedSubLanguage = false;
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        const trimmed = candidate.trim();
        if (!trimmed) { cursor += 1; continue; }
        if (FIELD_LINE.test(candidate) || SECTION_LANGUAGE.test(candidate) || /^#{1,6}\s/.test(trimmed) || /^[-=_]{3,}$/.test(trimmed)) break;
        const langBullet = LANGUAGE_LABEL.exec(candidate);
        if (langBullet) {
          consumedSubLanguage = true;
          const subQualifier = langBullet[1].toLowerCase();
          const subRaw = langBullet[2] || "";
          const subValue = isHashtag ? subRaw.replace(/\*\*/g, "").trim() : sanitizeCardField(subRaw);
          if (subValue) {
            found.push({ label, qualifier: [subQualifier, explicitQualifier].filter(Boolean).join(" ").trim(), text: subValue });
          }
          cursor += 1;
          continue;
        }
        if (consumedSubLanguage) break;
        const nextValue = isHashtag ? candidate.replace(/\*\*/g, "").trim() : sanitizeCardField(candidate);
        if (nextValue) {
          found.push({ label, qualifier: baseQualifier, text: nextValue });
        }
        cursor += 1;
        break;
      }
      index = cursor - 1;
      continue;
    }
    // Hashtags keep their leading "#"; every other field is markdown-cleaned.
    const value = isHashtag
      ? raw.replace(/\*\*/g, "").trim()
      : sanitizeCardField(raw);
    if (!value) continue;
    found.push({ label, qualifier: baseQualifier, text: value });
  }
  return found;
}

function selectLabelledCard(section: string, fallbackCta: string, preferredLanguage: "en" | "ar"): SocialPostCard | null {
  const list = labelledFields(section);
  if (!list.length) return null;
  const pick = (names: string[]) => {
    const matching = list.filter((field) => names.includes(field.label));
    if (preferredLanguage === "ar") {
      return matching.find((field) => ARABIC_QUALIFIER.test(field.qualifier) && !/\benglish\b/u.test(field.qualifier))
        ?? matching.find((field) => /[\u0600-\u06ff]/u.test(field.text))
        ?? matching[0];
    }
    return matching.find((field) => /english|en\b/u.test(field.qualifier) && !ARABIC_QUALIFIER.test(field.qualifier))
      ?? matching.find((field) => !field.qualifier || !ARABIC_QUALIFIER.test(field.qualifier))
      ?? matching[0];
  };
  const headline = pick(["opening", "headline", "hook", "الافتتاحية", "العنوان"]);
  const body = pick(["body", "caption", "text", "النص", "المتن", "المحتوى", "محتوى"]);
  if (!headline || !body) return null;
  const ctaField = pick(["cta", "cta button", "call to action", "نداء الإجراء", "دعوة لاتخاذ إجراء", "دعوة إلى اتخاذ إجراء"]);
  const hashtags = pick(["hashtags", "الهاشتاقات", "هاشتاقات"]);
  const headlineText = completeText(sanitizeCardField(headline.text), 160);
  const bodyText = completeText(sanitizeCardField(body.text), 360);
  if (!headlineText || !bodyText) return null;
  const ctaText = completeText(sanitizeCta(ctaField?.text || "", fallbackCta), 90);
  return { headline: headlineText, body: bodyText, cta: ctaText, hashtags: hashtagText(hashtags?.text) };
}

function labelledCard(section: string, fallbackCta: string): SocialPostCard | null {
  return selectLabelledCard(section, fallbackCta, "en");
}

// Some drafts label a whole paragraph by language instead of labelling each
// part: "**English:** …" then "**Levantine Arabic (اللهجة الشامية):** …".
const LANGUAGE_LABEL = /^\s*[*\-•]?\s*\*{0,2}\s*((?:modern standard |levantine |gulf |khaleeji |saudi |egyptian )?arabic(?:\s*\([^)]*\))?|english(?:\s*\([^)]*\))?)\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(.*)$/iu;
const CTA_HEADING = /call to action|نداء الإجراء|دعوة للتفاعل|دعوة لاتخاذ إجراء|دعوة إلى اتخاذ إجراء/iu;
const COPY_HEADING = /^#{3,6}\s*(?:post copy|copy|نص المنشور|النص)\b/iu;
const SKIP_SECTION = /^#{1,6}\s*(?:visual brief|visual direction|format|توصيف بصري|التنسيق)/iu;

function plain(line: string) {
  return clean(line.replace(/^#{1,6}\s*/, ""));
}

function postSections(source: string): string[][] {
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of source.split("\n")) {
    const heading = /^##\s+(.+)$/u.exec(line);
    if (heading) {
      current = /post|draft|منشور|مسودة/iu.test(heading[1]) ? [] : null;
      if (current) sections.push(current);
      continue;
    }
    if (current) current.push(line);
  }
  return sections;
}

function splitHeadline(text: string) {
  const sentence = /^(.{20,140}?[.!?؟])\s+([\s\S]+)$/u.exec(text);
  if (sentence) return { headline: sentence[1], body: sentence[2] };
  const words = text.split(/\s+/u);
  if (words.length < 14) return null;
  return { headline: words.slice(0, 12).join(" "), body: words.slice(12).join(" ") };
}

function hashtagText(value?: string) {
  const text = (value || "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return text || undefined;
}

// Keeps sub-headings like "### English Copy" and "### Arabic Copy (MSA)"
// inside their parent "## Post N" section instead of splitting them away.
function extractPostSections(source: string): string[] {
  const sections: string[][] = [];
  let current: string[] | null = null;
  let postLevel = 0;
  for (const line of source.split("\n")) {
    const heading = /^(\s*)(#{1,4})\s+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[2].length;
      if (POST_SECTION.test(line)) {
        current = [line];
        postLevel = level;
        sections.push(current);
        continue;
      }
      if (current && level <= postLevel) {
        current = null;
        postLevel = 0;
        continue;
      }
    }
    if (current) current.push(line);
  }
  return sections.map((entry) => entry.join("\n"));
}

function segmentedCard(body: string[], fallbackCta: string): SocialPostCard | null {
  // Hashtags live in their own field; they are never a call to action.
  let hashtags = "";
  for (const line of body) {
    const labelled = HASHTAG_LABEL.exec(line);
    if (labelled) { hashtags = labelled[1].trim(); continue; }
    if (!hashtags && (line.match(/#/g) || []).length >= 2 && line.trim().length < 240) hashtags = line.replace(/\*\*/g, "").trim();
  }
  const copyStart = body.findIndex((line) => COPY_HEADING.test(line));
  let lines = copyStart >= 0 ? body.slice(copyStart + 1) : body;
  const ctaIndex = lines.findIndex((line) => CTA_HEADING.test(plain(line)));
  let inlineCta = "";
  const ctaLines: string[] = [];
  if (ctaIndex >= 0) {
    // "* **Call to Action:** Order your home essentials today!" carries its copy
    // on the heading line itself, so read it there before looking below.
    inlineCta = sanitizeCardField(plain(lines[ctaIndex]).replace(CTA_HEADING, "").replace(/^[:：\s*\-–]+/, ""));
    ctaLines.push(...lines.slice(ctaIndex + 1));
    lines = lines.slice(0, ctaIndex);
  }

  const segments = new Map<string, string>();
  let language = "";
  for (const line of lines) {
    if (SKIP_SECTION.test(line) || SKIP_META_LINE.test(line)) continue;
    const langHeading = SECTION_LANGUAGE.exec(line);
    if (langHeading) {
      language = langHeading[1] ? "english" : "arabic";
      continue;
    }
    const label = LANGUAGE_LABEL.exec(line);
    if (label) {
      language = label[1].toLowerCase();
      const inline = sanitizeCardField(label[2] || "");
      if (inline) segments.set(language, `${segments.get(language) || ""} ${inline}`.trim());
      continue;
    }
    if (/^\s*\|/.test(line) || /^\s*[-=]{3,}\s*$/.test(line)) continue;
    const text = sanitizeCardField(plain(line));
    if (!text || HASHTAG_HEADING.test(text) || /^hashtags?\b/iu.test(text) || /^#/.test(text) || NON_POST_HEADLINE.test(text)) continue;
    segments.set(language, `${segments.get(language) || ""} ${text}`.trim());
  }

  const english = [...segments.entries()].find(([key]) => /english/u.test(key))?.[1];
  const text = (english || [...segments.values()].join(" ")).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const split = splitHeadline(text);
  if (!split) return null;

  let cta = sanitizeCta(inlineCta, "");
  if (!cta) {
    for (const line of ctaLines) {
      if (SKIP_SECTION.test(line) || SKIP_META_LINE.test(line) || SECTION_LANGUAGE.test(line)) continue;
      const text = plain(line);
      // A hashtag line or visual brief can never become the card CTA.
      if (HASHTAG_HEADING.test(text) || /^#/.test(text) || /(?:^|\s)#[^\s#]+/u.test(text) || DISALLOWED_CTA.test(text)) continue;
      const label = LANGUAGE_LABEL.exec(line);
      const candidate = sanitizeCta((label ? label[2] : text.replace(CTA_HEADING, "")).replace(/^[*\-•:：\s]+/, ""), "");
      if (!candidate) continue;
      if (label && /english/iu.test(label[1])) { cta = candidate; break; }
      if (!label) { cta = candidate; break; }
    }
  }
  return {
    headline: completeText(sanitizeCardField(split.headline), 160),
    body: completeText(sanitizeCardField(split.body), 360),
    cta: completeText(sanitizeCta(cta, fallbackCta), 90),
    hashtags: hashtagText(hashtags),
  };
}

/** Extracts up to three brand-consistent post cards from a generated draft. */
export function socialPostCards(document: string, kit: WorkspaceBrandKit | null, preferredLanguage: "en" | "ar" = "en"): SocialPostCard[] {
  if (!document) return [];
  const source = document.replace(/\r\n/g, "\n");
  const fallbackCta = brandCta(kit);
  const cards: SocialPostCard[] = [];
  const sections = extractPostSections(source);
  for (const section of sections.length ? sections : [source]) {
    const card = preferredLanguage === "en"
      ? labelledCard(section, fallbackCta)
      : selectLabelledCard(section, fallbackCta, preferredLanguage);
    if (card) cards.push(card);
    if (cards.length === 3) break;
  }
  if (cards.length) return cards;

  // Paragraphs labelled only by language, inside a post section.
  for (const section of postSections(source)) {
    const card = segmentedCard(section, fallbackCta);
    if (card) cards.push(card);
    if (cards.length === 3) break;
  }
  if (cards.length) return cards;

  // Older drafts have no labels: fall back to paragraph extraction.
  const blocks = source.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  for (const block of blocks) {
    if (NON_POST_BLOCK.test(block)) continue;
    const lines = block.split("\n")
      .filter((line) => !SKIP_META_LINE.test(line) && !SECTION_LANGUAGE.test(line))
      .map(clean)
      .map(stripStructuralPrefix)
      .filter(Boolean);
    if (!lines.length) continue;
    const headline = completeText(sanitizeCardField(lines[0]), 96);
    if (!headline || NON_POST_BLOCK.test(headline) || NON_POST_HEADLINE.test(headline)) continue;
    if (/^hashtags?\s*[:：]/i.test(headline)) continue;
    const rest = lines.slice(1).filter((line) => !/^hashtags?\s*[:：]/i.test(line) && !/^الهاشتاقات?\s*[:：]/.test(line) && !NON_POST_HEADLINE.test(line));
    const bodyStart = rest.findIndex((line) => line.length >= 30);
    if (bodyStart < 0) continue;
    const bodyLines = rest.slice(bodyStart);
    const ctaIndex = bodyLines.findIndex((line) => CTA_PATTERN.test(line) && line.length <= 90 && !DISALLOWED_CTA.test(line));
    const cta = ctaIndex >= 0 ? completeText(sanitizeCta(bodyLines[ctaIndex], fallbackCta), 90) : completeText(sanitizeCta("", fallbackCta), 90);
    const body = completeText(sanitizeCardField((ctaIndex >= 0 ? bodyLines.filter((_, index) => index !== ctaIndex) : bodyLines).join(" ")), 240);
    if (!body) continue;
    cards.push({ headline, body, cta });
    if (cards.length === 3) break;
  }
  return cards;
}

/** Wraps to at most `maxLines` complete lines, preferring a finished sentence. */
function fitLines(text: string, perLine: number, maxLines: number) {
  const lines = wrap(text, perLine);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines).join(" ");
  const sentence = Math.max(...[". ", "؟ ", "! "].map((token) => kept.lastIndexOf(token)));
  const candidate = sentence >= 0 ? wrap(kept.slice(0, sentence + 1), perLine) : wrap(lines.slice(0, maxLines - 1).join(" "), perLine);
  const visible = candidate.slice(0, maxLines);
  return visible.length ? visible : [completeText(text, perLine)];
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PostCard({
  card,
  index,
  kit,
  language,
  brandName,
}: {
  card: SocialPostCard;
  index: number;
  kit: WorkspaceBrandKit | null;
  language: "en" | "ar";
  brandName: string;
}) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const svg = useRef<SVGSVGElement>(null);
  const tones = palette(kit);
  const rtl = language === "ar";
  const font = rtl ? (kit?.arabic_font || "Cairo, Tajawal, sans-serif") : (kit?.latin_font || "Inter, sans-serif");
  // Cards are drawn on the primary colour; white text keeps AA contrast on the
  // dark palettes the brand kit validation allows.
  const ink = tokensOn(tones.primary) ? "#FFFFFF" : "#101828";
  const filename = `tanaghom-post-${index + 1}`;
  // Adaptive type: long Arabic or English copy shrinks instead of clipping.
  const headlineSize = card.headline.length > 120 ? 34 : card.headline.length > 84 ? 40 : card.headline.length > 52 ? 48 : 60;
  const headlinePerLine = Math.max(16, Math.round(880 / (headlineSize * 0.56)));
  const headlineLines = fitLines(card.headline, headlinePerLine, 5);
  const headlineLineHeight = Math.round(headlineSize * 1.22);
  const headlineTop = 310;
  const bodyTop = headlineTop + headlineLines.length * headlineLineHeight + 36;
  const bodySize = card.body.length > 260 ? 28 : card.body.length > 180 ? 31 : card.body.length > 110 ? 34 : 38;
  const bodyPerLine = Math.max(18, Math.round(880 / (bodySize * 0.54)));
  const bodyLineHeight = Math.round(bodySize * 1.34);
  const maxBodyLines = Math.max(1, Math.min(7, Math.floor((820 - bodyTop) / bodyLineHeight)));
  const bodyLines = fitLines(card.body, bodyPerLine, maxBodyLines);
  // The full CTA (up to 90 characters) wraps onto centred lines inside the badge.
  const ctaSize = card.cta.length > 40 ? 27 : 30;
  const ctaPerLine = Math.max(12, Math.round(480 / (ctaSize * 0.54)));
  const ctaLines = card.cta ? fitLines(card.cta, ctaPerLine, 3) : [];
  const ctaLineHeight = Math.round(ctaSize * 1.3);
  const designHref = `/creative/designs?${new URLSearchParams({ from: "workspace", title: card.headline, headline: card.headline, body: card.body, cta: card.cta, lang: language }).toString()}`;

  function saveSvg() {
    if (!svg.current) return;
    const xml = new XMLSerializer().serializeToString(svg.current);
    download(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
  }

  function savePng() {
    if (!svg.current) return;
    const xml = new XMLSerializer().serializeToString(svg.current);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1080;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(image, 0, 0, 1080, 1080);
        canvas.toBlob((blob) => {
          if (blob) download(blob, `${filename}.png`);
        }, "image/png");
      }
      URL.revokeObjectURL(url);
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }

  return (
    <article className="aw-post-card">
      <svg
        ref={svg}
        viewBox="0 0 1080 1080"
        role="img"
        aria-label={`${brandName || "Tanaghom"} · ${card.headline}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="1080" height="1080" fill={tones.primary} />
        <rect x="0" y="0" width="1080" height="18" fill={tones.accent} />
        <rect x="88" y="88" width="904" height="904" rx="28" fill={tones.background} opacity="0.08" />
        <text x={rtl ? 992 : 88} y="150" fill={ink} opacity="0.78" fontFamily={font} fontSize="30" textAnchor={rtl ? "end" : "start"} direction={rtl ? "rtl" : "ltr"}>
          {brandName || "Tanaghom"}
        </text>
        <text
          x={rtl ? 992 : 88}
          y={headlineTop}
          fill={ink}
          fontFamily={font}
          fontSize={headlineSize}
          fontWeight="700"
          textAnchor={rtl ? "end" : "start"}
          direction={rtl ? "rtl" : "ltr"}
        >
          {headlineLines.map((line, lineIndex) => (
            <tspan key={`${line}-${lineIndex}`} x={rtl ? 992 : 88} dy={lineIndex === 0 ? 0 : headlineLineHeight}>{line}</tspan>
          ))}
        </text>
        <text
          x={rtl ? 992 : 88}
          y={bodyTop}
          fill={ink}
          opacity="0.88"
          fontFamily={font}
          fontSize={bodySize}
          textAnchor={rtl ? "end" : "start"}
          direction={rtl ? "rtl" : "ltr"}
        >
          {bodyLines.map((line, lineIndex) => (
            <tspan key={`${line}-${lineIndex}`} x={rtl ? 992 : 88} dy={lineIndex === 0 ? 0 : bodyLineHeight}>{line}</tspan>
          ))}
        </text>
        {ctaLines.length ? (
          <g>
            <rect x={rtl ? 992 - 560 : 88} y="852" width="560" height="140" rx="30" fill={tones.accent} />
            <text
              x={rtl ? 992 - 280 : 88 + 280}
              y={852 + 70}
              fill="#101828"
              fontFamily={font}
              fontSize={ctaSize}
              fontWeight="700"
              textAnchor="middle"
              dominantBaseline="central"
              direction={rtl ? "rtl" : "ltr"}
            >
              {ctaLines.map((line, lineIndex) => (
                <tspan key={`${line}-${lineIndex}`} x={rtl ? 992 - 280 : 88 + 280} dy={lineIndex === 0 ? -((ctaLines.length - 1) * ctaLineHeight) / 2 : ctaLineHeight}>{line}</tspan>
              ))}
            </text>
          </g>
        ) : null}
      </svg>
      <div className="aw-post-card-actions">
        <button className="button button-secondary" type="button" onClick={saveSvg}><Download size={15} />{ar ? "تنزيل SVG" : "Download SVG"}</button>
        <button className="button button-secondary" type="button" onClick={savePng}><Download size={15} />{ar ? "تنزيل PNG" : "Download PNG"}</button>
      </div>
      <Link className="text-link" href={designHref}>
        {ar ? "افتح البطاقة في استوديو التصاميم" : "Open card in Design Studio"} <ExternalLink size={15} />
      </Link>
    </article>
  );
}

function tokensOn(hex: string) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) || 0);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

function wrap(text: string, size: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current ? `${current} ${word}` : word).length > size) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function WorkspacePostCards({
  document,
  kit,
  language,
}: {
  document: string;
  kit: WorkspaceBrandKit | null;
  language: "en" | "ar";
}) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const cards = socialPostCards(document, kit, language);
  if (!cards.length) return null;
  const brandName = kit?.brand_name || kit?.name || "Tanaghom";
  return (
    <section className="aw-post-cards" aria-labelledby="aw-post-cards-title">
      <header>
        <h4 id="aw-post-cards-title"><Sparkles size={16} aria-hidden="true" />{ar ? "بطاقات المنشورات البصرية" : "Visual post cards"}</h4>
        <p>{ar
          ? `مبنية من هويتك البصرية النشطة (${brandName}) دون أي خدمة صور خارجية أو تكلفة إضافية.`
          : `Built from your active brand kit (${brandName}) with no external image service or extra cost.`}</p>
      </header>
      <div className="aw-post-card-strip">
        {cards.map((card, index) => (
          <PostCard key={`${card.headline}-${index}`} card={card} index={index} kit={kit} language={language} brandName={brandName} />
        ))}
      </div>
      <Link className="text-link" href="/creative/designs">
        {ar ? "افتح في استوديو التصاميم" : "Open in Design Studio"} <ExternalLink size={15} />
      </Link>
    </section>
  );
}
