"use client";

import { AlertTriangle, CheckCircle2, Clock, Film, Info, Repeat, Sparkles, Type, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useLocale } from "@/lib/client/use-locale";
import { dialectLabel, type DialectId } from "@/lib/i18n/dialects";
import { REEL_HOOK_FORMULAS } from "@/lib/reel-hooks";
import {
  analyzeReelBeats,
  DEFAULT_TARGET_SECONDS,
  DEFAULT_WPM_AR,
  DEFAULT_WPM_EN,
  HOOK_FILTER_SCOPE,
  MAX_ON_SCREEN_WORDS,
  parseReelScriptDocument,
  scoreReelHook,
} from "@/lib/reel-script";
import { CaptionPreviewLinter } from "./caption-preview-linter";

export function ReelScriptStudio({
  document,
  language,
  dialect = "msa",
  compact = false,
}: {
  document: string;
  language: "en" | "ar";
  dialect?: DialectId;
  compact?: boolean;
}) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [viewLang, setViewLang] = useState<"en" | "ar">(language);
  const [customHook, setCustomHook] = useState("");
  const [wpmInput, setWpmInput] = useState<number>(language === "ar" ? DEFAULT_WPM_AR : DEFAULT_WPM_EN);
  const [targetSecInput, setTargetSecInput] = useState<number>(DEFAULT_TARGET_SECONDS);

  useEffect(() => {
    setViewLang(language);
  }, [document, language]);

  const parsed = useMemo(
    () => parseReelScriptDocument(document, { language: viewLang }),
    [document, viewLang],
  );

  useEffect(() => {
    setWpmInput(parsed.language === "ar" ? DEFAULT_WPM_AR : DEFAULT_WPM_EN);
  }, [parsed.language]);

  const liveBeats = useMemo(
    () => (parsed.spokenScript
      ? analyzeReelBeats(parsed.spokenScript, {
          wpm: wpmInput,
          targetSeconds: targetSecInput,
          language: parsed.language,
        })
      : null),
    [parsed.spokenScript, parsed.language, wpmInput, targetSecInput],
  );

  const customHookScore = useMemo(
    () => (customHook.trim() ? scoreReelHook(customHook, { language: /[\u0600-\u06ff]/u.test(customHook) ? "ar" : parsed.language }) : null),
    [customHook, parsed.language],
  );

  const scriptDir: "rtl" | "ltr" = parsed.language === "ar" ? "rtl" : "ltr";
  const gulfExamples = dialect === "gulf" || dialect === "sa";

  return (
    <section className="aw-reel-studio" aria-label={ar ? "استوديو نص الريلز" : "Reel Script Studio"}>
      <header className="aw-reel-header">
        <div>
          <h4>
            <Film size={17} aria-hidden="true" />
            {ar ? "أدوات نص الريلز وفحص الخطاف" : "Reel Script Studio & Hook Filter"}
          </h4>
          <p className="aw-muted">
            {ar
              ? `مسودة فقط — لا يُنشر أي محتوى قبل الموافقة البشرية · اللهجة: ${dialectLabel(dialect, "ar")}`
              : `Draft only — nothing publishes until human approval · Dialect: ${dialectLabel(dialect, "en")}`}
          </p>
        </div>
        {parsed.hasEnglishSection && parsed.hasArabicSection ? (
          <div className="aw-caption-lang-toggle" role="group" aria-label={ar ? "لغة عرض الريلز" : "Reel script view language"}>
            <button type="button" className={viewLang === "en" ? "aw-pill-active" : ""} onClick={() => setViewLang("en")}>
              English
            </button>
            <button type="button" className={viewLang === "ar" ? "aw-pill-active" : ""} onClick={() => setViewLang("ar")}>
              العربية
            </button>
          </div>
        ) : null}
      </header>

      <aside className="aw-reel-scope-note" role="note">
        <Info size={16} aria-hidden="true" />
        <p>
          {ar
            ? `تنبيه موضوعي لدرجة الخطاف: هذا الفاحص مصفّاة لاستبعاد البدايات الضعيفة (دقة الفصل AUC ${HOOK_FILTER_SCOPE.filter_auc} — يكشف التحيات والمقدمات وغياب الأرقام)، وليس متنبّئاً بالانتشار: الترجيح بين خطافين جيدين لا يتجاوز رمية النرد (AUC ${HOOK_FILTER_SCOPE.winner_auc}).`
            : `Honest scorer scope: this is a weak-hook filter (AUC ${HOOK_FILTER_SCOPE.filter_auc} — catches greetings, video preambles, missing specifics, and slow openers before filming), NOT a virality predictor: picking a winner between two decent hooks is a coin flip (AUC ${HOOK_FILTER_SCOPE.winner_auc}).`}
        </p>
      </aside>

      {parsed.placeholders.length > 0 ? (
        <aside className="aw-reel-placeholders" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>
              {ar
                ? `بيانات مطلوبة من المالك قبل التصوير (${parsed.placeholders.length}) — لم نختلق أرقاماً:`
                : `Owner facts needed before filming (${parsed.placeholders.length}) — no invented numbers:`}
            </strong>
            <div className="aw-placeholder-chips">
              {parsed.placeholders.map((ph) => <code key={ph}>{ph}</code>)}
            </div>
          </div>
        </aside>
      ) : null}

      <div className="aw-reel-block">
        <h5>
          <Sparkles size={15} aria-hidden="true" />
          {ar ? "1) خيارات الخطاف الثلاثة (ترتيب مصفاة الخطافات الضعيفة)" : "1) Three Hook Options (Weak-Hook Filter Ranking)"}
        </h5>
        {parsed.hooks.length > 0 ? (
          <div className="aw-hook-grid">
            {parsed.hooks.map((item, rank) => (
              <article key={`${item.optionIndex}-${rank}`} className={`aw-hook-card aw-verdict-${item.scored.verdict.toLowerCase()}`} dir={scriptDir}>
                <header>
                  <span className="aw-hook-rank">#{rank + 1}</span>
                  <strong>
                    {item.formulaId ? `#${item.formulaId} ` : ""}
                    {item.formulaName}
                  </strong>
                  <span className={`aw-hook-score aw-verdict-badge-${item.scored.verdict.toLowerCase()}`}>
                    {item.scored.score} · {item.scored.verdict}
                  </span>
                </header>
                <p className="aw-hook-spoken">“{item.spoken}”</p>
                {item.onScreen ? (
                  <p className="aw-hook-screen">
                    <span>{ar ? "على الشاشة:" : "On screen:"}</span> <strong>{item.onScreen}</strong>{" "}
                    <small className={item.onScreenOk ? "aw-pill-ok" : "aw-pill-warn"}>
                      {item.onScreenWords}/{MAX_ON_SCREEN_WORDS} {ar ? "كلمات" : "words"}
                    </small>
                  </p>
                ) : null}
                {item.why ? <p className="aw-muted aw-hook-why">{item.why}</p> : null}
                {item.scored.flags.length > 0 ? (
                  <ul className="aw-hook-flags">
                    {item.scored.flags.map((f, idx) => (
                      <li key={idx}><XCircle size={13} aria-hidden="true" /> {ar ? f.ar : f.en}</li>
                    ))}
                  </ul>
                ) : null}
                <details className="aw-hook-breakdown">
                  <summary>
                    {ar
                      ? `فحص الخمسة محاور (أضعف نقطة: ${item.scored.weakest})`
                      : `5-check weak-hook filter detail (weakest: ${item.scored.weakest})`}
                  </summary>
                  <ul>
                    {(["LENGTH", "SPECIFICITY", "STAKES", "FRONTLOAD", "ADDRESS"] as const).map((key) => {
                      const chk = item.scored.checks[key];
                      return (
                        <li key={key}>
                          <span><strong>{key}</strong> ({chk.score}/100)</span>
                          <small>{ar ? chk.detail_ar : chk.detail_en}</small>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <p className="aw-muted">
            {ar
              ? "لم يُعثر على قسم خيارات خطاف منسق في المستند. اختبروا خطافاً أدناه أو راجعوا النص الكامل."
              : "No structured Hook Options block was parsed from the draft. Test a hook below or inspect the full text above."}
          </p>
        )}

        <div className="aw-hook-tester">
          <label>
            <span>{ar ? "اختبر خطافاً بديلاً بمصفاة الخطافات الضعيفة:" : "Test a custom spoken hook with the weak-hook filter:"}</span>
            <input
              type="text"
              dir="auto"
              value={customHook}
              onChange={(e) => setCustomHook(e.target.value)}
              placeholder={ar ? "مثال: وقفوا نشر يومي — 5 خطوات بـ 20 دقيقة تضبط حسابكم" : "e.g. Proposals used to take 5 hours. Twenty minutes now."}
            />
          </label>
          {customHookScore ? (
            <div className="aw-hook-tester-result">
              <span className={`aw-hook-score aw-verdict-badge-${customHookScore.verdict.toLowerCase()}`}>
                {customHookScore.score} · {customHookScore.verdict}
              </span>
              {customHookScore.formula ? (
                <small>
                  {ar
                    ? `الصيغة المطابقة: #${customHookScore.formula.id} ${customHookScore.formula.name_ar}`
                    : `Matched formula: #${customHookScore.formula.id} ${customHookScore.formula.name}`}
                </small>
              ) : null}
              <small>
                {ar
                  ? `أضعف محور: ${customHookScore.weakest} (${customHookScore.checks[customHookScore.weakest].detail_ar})`
                  : `Weakest check: ${customHookScore.weakest} (${customHookScore.checks[customHookScore.weakest].detail_en})`}
              </small>
            </div>
          ) : null}
        </div>

        {!compact ? (
          <details className="aw-formula-playbook">
            <summary>{ar ? "استعراض صيغ الخطاف الـ 26 (عربي + إنجليزي)" : "Browse all 26 Reel Hook Formulas (EN + Arabic)"}</summary>
            <div className="aw-formula-list">
              {REEL_HOOK_FORMULAS.map((f) => (
                <div key={f.id} className="aw-formula-row">
                  <strong>#{f.id} {ar ? `${f.ar.name} — ${f.name}` : `${f.name} — ${f.ar.name}`}</strong>
                  <p dir={ar ? "rtl" : "ltr"}>{ar ? (gulfExamples ? f.ar.example_gulf : f.ar.example) : f.example}</p>
                  <small>{ar ? `على الشاشة: «${f.ar.on_screen}» · فخ شائع: ${f.ar.trap}` : `On screen: “${f.on_screen}” · Trap: ${f.trap}`}</small>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      {liveBeats ? (
        <div className="aw-reel-block">
          <div className="aw-reel-subhead">
            <h5>
              <Clock size={15} aria-hidden="true" />
              {ar ? "2) جدول التوقيت المنطوق (Timed Beat Sheet)" : "2) Timed Beat Sheet (~30s target)"}
            </h5>
            <div className="aw-beat-controls">
              <label>
                <span>{ar ? "سرعة الكلام (كلمة/دقيقة):" : "Speaking pace (WPM):"}</span>
                <input
                  type="number"
                  min={80}
                  max={260}
                  step={5}
                  value={wpmInput}
                  onChange={(e) => setWpmInput(Math.max(80, Math.min(260, Number(e.target.value) || 165)))}
                />
              </label>
              <label>
                <span>{ar ? "المدة المستهدفة (ث):" : "Target (sec):"}</span>
                <input
                  type="number"
                  min={15}
                  max={90}
                  step={5}
                  value={targetSecInput}
                  onChange={(e) => setTargetSecInput(Math.max(15, Math.min(90, Number(e.target.value) || 30)))}
                />
              </label>
            </div>
          </div>

          <div className="aw-beat-summary">
            <span>
              <strong>~{liveBeats.total_seconds}s</strong> · {liveBeats.total_words} {ar ? "كلمة" : "words"} ({liveBeats.wpm} WPM)
            </span>
            <span className={`aw-loop-pill ${liveBeats.loop.loops ? "aw-pill-ok" : "aw-pill-warn"}`}>
              <Repeat size={13} aria-hidden="true" />
              {liveBeats.loop.loops
                ? (ar ? `حلقة إغلاق (${liveBeats.loop.echoed_words.slice(0, 2).join("، ")})` : `Loops (“${liveBeats.loop.echoed_words.slice(0, 2).join(", ")}”)`)
                : (ar ? "بدون حلقة إغلاق" : "No hook loop word")}
            </span>
          </div>

          <ol className="aw-beat-table" dir={scriptDir}>
            {liveBeats.beats.map((b) => (
              <li key={b.n} className={b.flags_en.length ? "aw-beat-flagged" : ""}>
                <span className="aw-beat-tc">{b.timecode}</span>
                <span className="aw-beat-dur">{b.dur.toFixed(1)}s</span>
                <span className="aw-beat-role">{b.label || `#${b.n}`}</span>
                <div className="aw-beat-text">
                  <p>{b.text}</p>
                  {b.flags_en.length > 0 ? (
                    <small className="aw-beat-flag-msg">
                      <AlertTriangle size={12} aria-hidden="true" /> {(ar ? b.flags_ar : b.flags_en).join(" · ")}
                    </small>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          <ul className="aw-beat-notes">
            {(ar ? liveBeats.notes_ar : liveBeats.notes_en).map((note, idx) => (
              <li key={idx}><CheckCircle2 size={13} aria-hidden="true" /> {note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {parsed.onScreenCards.length > 0 ? (
        <div className="aw-reel-block">
          <h5>
            <Type size={15} aria-hidden="true" />
            {ar ? "3) نصوص الشاشة المنفصلة (≤ 6 كلمات)" : "3) Separate On-Screen Text Cards (<=6 words each)"}
          </h5>
          <p className="aw-muted aw-safe-zone-note">
            {ar
              ? "ضعوا بطاقة الخطاف في الإطار الأول (0:00). المنطقة الآمنة لإطار 1080×1920: بين y=230 و y=1440 مع ترك 230 بكسل يميناً، وإضافة ترجمة نصية صامتة للجسم."
              : "Put the hook card up at frame 1 (0:00). Safe zone on 1080×1920: stay within y=230..1440 and keep the right 230px clear of captions/buttons."}
          </p>
          <ul className="aw-onscreen-list" dir={scriptDir}>
            {parsed.onScreenCards.map((card) => (
              <li key={card.index}>
                <span className="aw-beat-tc">{card.timecode}</span>
                <strong>{card.text}</strong>
                <small className={card.withinLimit ? "aw-pill-ok" : "aw-pill-warn"}>
                  {card.words}/{MAX_ON_SCREEN_WORDS} {ar ? "كلمات" : "words"}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {parsed.caption ? (
        <CaptionPreviewLinter
          initialCaption={parsed.caption}
          language={parsed.language}
          job="reel"
          compact={compact}
          title={ar ? "4) وصف الريلز على إنستغرام — فحص أول 125 حرفاً" : "4) Reel Instagram Caption — 125-char Check"}
        />
      ) : null}
    </section>
  );
}
