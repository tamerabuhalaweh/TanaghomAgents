"use client";

import { AlertTriangle, CheckCircle2, Eye, RotateCcw, Search, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useLocale } from "@/lib/client/use-locale";
import {
  analyzeInstagramCaption,
  extractCaptionsFromSocialDraft,
  INSTAGRAM_CAPTION_LIMIT,
  INSTAGRAM_HASHTAG_LIMIT,
  INSTAGRAM_VISIBLE_CHARS,
  type CaptionCheckStatus,
} from "@/lib/instagram-caption";

const VERDICT_LABEL: Record<"READY" | "REVIEW" | "FIX", { en: string; ar: string }> = {
  READY: { en: "READY", ar: "جاهز" },
  REVIEW: { en: "REVIEW", ar: "يحتاج مراجعة" },
  FIX: { en: "FIX", ar: "يحتاج تعديل" },
};

function StatusIcon({ status }: { status: CaptionCheckStatus }) {
  if (status === "PASS") return <CheckCircle2 size={15} aria-hidden="true" />;
  if (status === "FAIL") return <XCircle size={15} aria-hidden="true" />;
  return <AlertTriangle size={15} aria-hidden="true" />;
}

export function CaptionPreviewLinter({
  initialCaption,
  language = "en",
  job = "post",
  initialKeywords = "",
  title,
  compact = false,
}: {
  initialCaption: string;
  language?: "en" | "ar";
  job?: "reel" | "post";
  initialKeywords?: string;
  title?: string;
  compact?: boolean;
}) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [caption, setCaption] = useState(initialCaption);
  const [keywordsText, setKeywordsText] = useState(initialKeywords);

  useEffect(() => {
    setCaption(initialCaption);
  }, [initialCaption]);

  const keywords = useMemo(
    () => keywordsText.split(/[,،\n]+/).map((s) => s.trim()).filter(Boolean),
    [keywordsText],
  );

  const analysis = useMemo(
    () => analyzeInstagramCaption(caption, { truncateAt: INSTAGRAM_VISIBLE_CHARS, keywords }),
    [caption, keywords],
  );

  const isCaptionArabic = language === "ar" || /[\u0600-\u06ff]/u.test(caption);
  const dir: "rtl" | "ltr" = isCaptionArabic ? "rtl" : "ltr";

  return (
    <section
      className={`aw-caption-check${compact ? " aw-caption-check-compact" : ""}`}
      aria-label={title || (ar ? "معاينة إنستغرام (أول 125 حرفاً)" : "Instagram 125-char caption preview")}
    >
      <header className="aw-caption-header">
        <div>
          <h4>
            <Eye size={16} aria-hidden="true" />
            {title || (ar ? "معاينة وفحص وصف إنستغرام (أول 125 حرفاً)" : "Instagram 125-char Caption Preview & Linter")}
          </h4>
          <p className="aw-muted">
            {job === "reel"
              ? (ar
                ? "الريلز نفسه يحمل الخطاف؛ مهمة الوصف هنا: دعوة واحدة واضحة، كلمات البحث، وحتى 5 هاشتاقات فقط."
                : "The Reel carries the hook; this Job A caption provides context, one clear CTA, search terms, and up to 5 specific tags.")
              : (ar
                ? "يقصّ إنستغرام النص بعد أول 125 حرفاً تقريباً في الخلاصة — هذا الصندوق يعرض ما يراه المتصفّح قبل «... المزيد»."
                : "Instagram truncates feed captions at ~125 characters before “... more”. This box shows what a scrolling stranger reads first.")}
          </p>
        </div>
        <span className={`aw-caption-verdict aw-caption-verdict-${analysis.verdict.toLowerCase()}`}>
          {ar ? VERDICT_LABEL[analysis.verdict].ar : VERDICT_LABEL[analysis.verdict].en}
        </span>
      </header>

      <div className="aw-caption-feed-box" aria-label={ar ? "الجزء الظاهر في خلاصة إنستغرام" : "Visible Instagram feed window"}>
        <div className="aw-caption-feed-head">
          <strong>{ar ? "ما يظهر في خلاصة إنستغرام قبل «المزيد»" : "What the Instagram feed shows before “... more”"}</strong>
          <span>
            {ar
              ? `${analysis.visible_characters} / ${INSTAGRAM_VISIBLE_CHARS} حرفاً ظاهراً · ${analysis.characters} / ${INSTAGRAM_CAPTION_LIMIT} إجمالاً · ${analysis.hashtags.length} / ${INSTAGRAM_HASHTAG_LIMIT} هاشتاق`
              : `${analysis.visible_characters} / ${INSTAGRAM_VISIBLE_CHARS} visible chars · ${analysis.characters} / ${INSTAGRAM_CAPTION_LIMIT} total · ${analysis.hashtags.length} / ${INSTAGRAM_HASHTAG_LIMIT} hashtags`}
          </span>
        </div>
        <div className="aw-caption-feed-window" dir={dir} lang={isCaptionArabic ? "ar" : "en"}>
          {analysis.visible ? (
            <>
              <span>{analysis.visible}</span>
              {analysis.truncated ? (
                <span className="aw-caption-more"> {isCaptionArabic ? "... المزيد" : "... more"}</span>
              ) : (
                <span className="aw-caption-fits"> {ar ? "(الوصف كامل ظاهر)" : "(whole caption fits)"}</span>
              )}
            </>
          ) : (
            <span className="aw-muted">{ar ? "اكتبوا وصفاً لمعاينة أول 125 حرفاً." : "Enter a caption to preview the first 125 characters."}</span>
          )}
        </div>
        {analysis.truncated && analysis.hidden ? (
          <details className="aw-caption-hidden">
            <summary>{ar ? `النص المخفي بعد الحرف 125 (${analysis.characters - analysis.visible_characters} حرفاً)` : `Behind “... more” (${analysis.characters - analysis.visible_characters} chars)`}</summary>
            <p dir={dir} lang={isCaptionArabic ? "ar" : "en"}>{analysis.hidden}</p>
          </details>
        ) : null}
      </div>

      <div className="aw-caption-inputs">
        <label>
          <span className="aw-caption-label-row">
            <span>{ar ? "تحرير الوصف لفحص القطع مباشرة" : "Edit caption to test the 125-char cut & rules live"}</span>
            {caption !== initialCaption ? (
              <button type="button" className="aw-link-reset" onClick={() => setCaption(initialCaption)}>
                <RotateCcw size={13} aria-hidden="true" /> {ar ? "استعادة المسودة" : "Reset draft"}
              </button>
            ) : null}
          </span>
          <textarea
            rows={compact ? 4 : 5}
            dir={dir}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={ar ? "اكتبوا وصف إنستغرام هنا..." : "Paste or edit an Instagram caption..."}
          />
        </label>
        <label>
          <span className="aw-caption-label-row">
            <span><Search size={13} aria-hidden="true" /> {ar ? "كلمات البحث المستهدفة (مفصولة بفاصلة)" : "Instagram search terms to check (comma-separated)"}</span>
          </span>
          <input
            type="text"
            dir="auto"
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            placeholder={ar ? "مثال: التسويق الرقمي، إدارة الحملات" : "e.g. client proposals, organic growth"}
          />
        </label>
      </div>

      <ul className="aw-caption-checklist" aria-label={ar ? "نتائج فحص الوصف" : "Caption lint checks"}>
        {analysis.checks.map((check) => (
          <li key={check.id} className={`aw-caption-check-item aw-status-${check.status.toLowerCase()}`}>
            <StatusIcon status={check.status} />
            <div>
              <strong>{ar ? check.label_ar : check.label_en}</strong>
              <span>{ar ? check.detail_ar : check.detail_en}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WorkspaceCaptionCheck({
  document,
  language,
  compact = false,
}: {
  document: string;
  language: "en" | "ar";
  compact?: boolean;
}) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const posts = useMemo(() => extractCaptionsFromSocialDraft(document), [document]);
  const [postIndex, setPostIndex] = useState(0);
  const [langChoice, setLangChoice] = useState<"en" | "ar">(language);

  useEffect(() => {
    setPostIndex(0);
    setLangChoice(language);
  }, [document, language]);

  if (!posts.length) return null;
  const activePost = posts[Math.min(postIndex, posts.length - 1)];
  const hasEn = Boolean(activePost.caption_en);
  const hasAr = Boolean(activePost.caption_ar);
  const effectiveLang: "en" | "ar" = hasEn && hasAr ? langChoice : hasAr ? "ar" : "en";
  const initialCaption = effectiveLang === "ar" ? activePost.caption_ar : activePost.caption_en;

  return (
    <div className="aw-caption-pack-wrap">
      <div className="aw-caption-pack-toolbar">
        <div className="aw-caption-post-tabs" role="tablist" aria-label={ar ? "اختيار المنشور للفحص" : "Select post caption to preview"}>
          {posts.map((p, idx) => (
            <button
              key={`${p.title}-${idx}`}
              type="button"
              role="tab"
              aria-selected={idx === postIndex}
              className={idx === postIndex ? "aw-pill-active" : ""}
              onClick={() => setPostIndex(idx)}
            >
              {ar ? `منشور ${idx + 1}` : `Post ${idx + 1}`}
            </button>
          ))}
        </div>
        {hasEn && hasAr ? (
          <div className="aw-caption-lang-toggle" role="group" aria-label={ar ? "لغة المعاينة" : "Caption preview language"}>
            <button
              type="button"
              className={effectiveLang === "en" ? "aw-pill-active" : ""}
              onClick={() => setLangChoice("en")}
            >
              EN
            </button>
            <button
              type="button"
              className={effectiveLang === "ar" ? "aw-pill-active" : ""}
              onClick={() => setLangChoice("ar")}
            >
              AR
            </button>
          </div>
        ) : null}
      </div>
      <CaptionPreviewLinter
        initialCaption={initialCaption}
        language={effectiveLang}
        job="post"
        compact={compact}
        title={ar ? `معاينة أول 125 حرفاً — ${activePost.title}` : `125-char Instagram Preview — ${activePost.title}`}
      />
    </div>
  );
}
