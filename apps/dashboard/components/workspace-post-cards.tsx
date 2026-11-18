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
const STRUCTURAL_PREFIX = /^(?:opening|headline|hook|body|caption|cta|cta button|call to action|english copy|arabic copy|english version|arabic version|الافتتاحية|العنوان|النص|المتن|نداء الإجراء|النسخة العربية|النسخة الإنجليزية|النص العربي|النص الإنجليزي)\s*(?:\((?:english|arabic|en|ar|عربي|عربية|إنجليزي|الإنجليزية|العربية)\))?\s*[:：\-–]\s*/iu;

export function stripStructuralPrefix(line: string) {
  let value = line;
  for (let index = 0; index < 3; index += 1) {
    const next = value.replace(STRUCTURAL_PREFIX, "").trim();
    if (next === value || !next) break;
    value = next;
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

/** Extracts up to two brand-consistent post cards from a generated draft. */
export function socialPostCards(document: string, kit: WorkspaceBrandKit | null): SocialPostCard[] {
  if (!document) return [];
  const blocks = document.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const fallbackCta = brandCta(kit);
  const cards: SocialPostCard[] = [];
  for (const block of blocks) {
    if (NON_POST_BLOCK.test(block)) continue;
    const lines = block.split("\n").map(clean).map(stripStructuralPrefix).filter(Boolean);
    if (!lines.length) continue;
    const headline = completeText(lines[0], 96);
    if (!headline || NON_POST_BLOCK.test(headline) || /^hashtags?\s*[:：]/i.test(headline)) continue;
    const rest = lines.slice(1).filter((line) => !/^hashtags?\s*[:：]/i.test(line) && !/^الهاشتاقات?\s*[:：]/.test(line));
    const bodyStart = rest.findIndex((line) => line.length >= 30);
    if (bodyStart < 0) continue;
    const bodyLines = rest.slice(bodyStart);
    const ctaIndex = bodyLines.findIndex((line) => CTA_PATTERN.test(line) && line.length <= 90);
    const cta = ctaIndex >= 0 ? completeText(bodyLines[ctaIndex], 44) : completeText(fallbackCta, 44);
    const body = completeText((ctaIndex >= 0 ? bodyLines.filter((_, index) => index !== ctaIndex) : bodyLines).join(" "), 240);
    if (!body) continue;
    cards.push({ headline, body, cta });
    if (cards.length === 2) break;
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
  const headlineSize = card.headline.length > 64 ? 42 : card.headline.length > 40 ? 52 : 64;
  const headlinePerLine = Math.max(16, Math.round(880 / (headlineSize * 0.56)));
  const headlineLines = fitLines(card.headline, headlinePerLine, 4);
  const headlineLineHeight = Math.round(headlineSize * 1.2);
  const bodyTop = 470 + headlineLines.length * headlineLineHeight + 34;
  const bodySize = card.body.length > 150 ? 30 : card.body.length > 90 ? 34 : 38;
  const bodyPerLine = Math.max(18, Math.round(880 / (bodySize * 0.54)));
  const bodyLineHeight = Math.round(bodySize * 1.32);
  const maxBodyLines = Math.max(1, Math.min(5, Math.floor((840 - bodyTop) / bodyLineHeight)));
  const bodyLines = fitLines(card.body, bodyPerLine, maxBodyLines);
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
          y="470"
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
        {card.cta ? (
          <g>
            <rect x={rtl ? 992 - 420 : 88} y="880" width="420" height="94" rx="47" fill={tones.accent} />
            <text
              x={rtl ? 992 - 210 : 88 + 210}
              y="940"
              fill="#101828"
              fontFamily={font}
              fontSize="34"
              fontWeight="700"
              textAnchor="middle"
              direction={rtl ? "rtl" : "ltr"}
            >
              {card.cta.slice(0, 26)}
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
  const cards = socialPostCards(document, kit);
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
