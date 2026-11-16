"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";
import { DIALECTS, dialectLabel, normalizeDialect, type DialectId } from "@/lib/i18n/dialects";
import { CreativeApiError, LoadError, Loading, api, idempotencyKey, useCreativeFetch, useSessionRole } from "@/components/creative/api";
import { CreativeSubnav } from "@/components/creative/creative-subnav";
import { formatNumber, normalizeDigits } from "@/lib/i18n/format";

interface KitRow {
  kit_id: string;
  name: string;
  current_version: number;
  versions: number;
}

interface KitDetail {
  kit_id: string;
  name: string;
  current_version: number;
  created_at: string;
}

interface KitVersionRow {
  version_id: string;
  version: number;
  colors: unknown;
  tone: string | null;
  arabic_font: string | null;
  latin_font: string | null;
  rules: unknown;
}

interface BrandDraft {
  primary: string;
  accent: string;
  background: string;
  tone: string;
  arabicFont: string;
  latinFont: string;
  dialect: DialectId;
  rules: Record<string, unknown>;
}

const COLOR = /^#[0-9a-f]{6}$/i;

const emptyDraft: BrandDraft = {
  primary: "#0F766E",
  accent: "",
  background: "#FFFFFF",
  tone: "",
  arabicFont: "",
  latinFont: "",
  dialect: "msa",
  rules: {},
};

const palettes = [
  { id: "emerald", en: "Emerald & Gold", ar: "زمردي وذهبي", primary: "#0F766E", accent: "#D9A441", background: "#F8FAF7" },
  { id: "ocean", en: "Ocean & Slate", ar: "محيطي ورمادي", primary: "#0E7490", accent: "#64748B", background: "#F8FAFC" },
  { id: "royal", en: "Royal & Sand", ar: "ملكي ورملي", primary: "#4338CA", accent: "#C2A878", background: "#FDFBF7" },
  { id: "mono", en: "Monochrome", ar: "أحادي اللون", primary: "#111827", accent: "#6B7280", background: "#FFFFFF" },
] as const;

const toneChips = [
  { en: "Warm & confident", ar: "دافئة وواثقة" },
  { en: "Professional & concise", ar: "مهنية ومختصرة" },
  { en: "Friendly & conversational", ar: "ودودة وعفوية" },
] as const;

const arabicFonts = ["", "Cairo", "Tajawal", "IBM Plex Sans Arabic", "Almarai"];
const latinFonts = ["", "Inter", "Plus Jakarta Sans", "DM Sans"];

function colorsRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function dialectFromRules(rules: unknown): DialectId {
  return normalizeDialect(objectRecord(rules).arabic_dialect) ?? "msa";
}

function draftFromVersion(version: KitVersionRow | undefined): BrandDraft {
  if (!version) return emptyDraft;
  const colors = colorsRecord(version.colors);
  return {
    primary: COLOR.test(colors.primary ?? "") ? colors.primary.toUpperCase() : emptyDraft.primary,
    accent: COLOR.test(colors.accent ?? "") ? colors.accent.toUpperCase() : "",
    background: COLOR.test(colors.background ?? "") ? colors.background.toUpperCase() : "#FFFFFF",
    tone: version.tone ?? "",
    arabicFont: version.arabic_font ?? "",
    latinFont: version.latin_font ?? "",
    dialect: dialectFromRules(version.rules),
    rules: objectRecord(version.rules),
  };
}

function brandPayload(draft: BrandDraft) {
  const colors: Record<string, string> = { primary: draft.primary };
  if (draft.accent.trim()) colors.accent = draft.accent.trim();
  if (draft.background.trim()) colors.background = draft.background.trim();
  return {
    colors,
    tone: draft.tone.trim() || null,
    arabic_font: draft.arabicFont || null,
    latin_font: draft.latinFont || null,
    rules: { ...draft.rules, arabic_dialect: draft.dialect },
  };
}

function valid(draft: BrandDraft) {
  return COLOR.test(draft.primary)
    && (!draft.accent.trim() || COLOR.test(draft.accent.trim()))
    && (!draft.background.trim() || COLOR.test(draft.background.trim()));
}

function ColorControl({ label, optional, value, onChange, locale }: {
  label: string;
  optional?: boolean;
  value: string;
  onChange: (value: string) => void;
  locale: CreativeLocale;
}) {
  const safe = COLOR.test(value) ? value : "#FFFFFF";
  return (
    <div className="brand-color-field">
      <span>{label}{optional ? <small>{locale === "ar" ? " اختياري" : " optional"}</small> : null}</span>
      <div className="brand-color-controls">
        <input type="color" value={safe} aria-label={label} onChange={(event) => onChange(event.target.value.toUpperCase())} />
        <input type="text" value={value} maxLength={7} dir="ltr" aria-label={`${label} ${locale === "ar" ? "قيمة اللون" : "color value"}`} onChange={(event) => onChange(normalizeDigits(event.target.value))} />
        <i style={{ background: safe }} aria-hidden="true" />
      </div>
    </div>
  );
}

function BrandPreview({ draft, locale }: { draft: BrandDraft; locale: CreativeLocale }) {
  const ar = locale === "ar";
  const primary = COLOR.test(draft.primary) ? draft.primary : "#0F766E";
  const accent = COLOR.test(draft.accent) ? draft.accent : primary;
  const background = COLOR.test(draft.background) ? draft.background : "#FFFFFF";
  const style = {
    "--brand-preview-primary": primary,
    "--brand-preview-accent": accent,
    "--brand-preview-background": background,
  } as CSSProperties;
  return (
    <section className="brand-preview" style={style} aria-label={t(locale, "brands.previewTitle")}>
      <header><span>{t(locale, "brands.previewTitle")}</span><span className="brand-dialect-badge">{dialectLabel(draft.dialect, locale)}</span><i /><i /><i /></header>
      <div className="brand-preview-posts">
        {ar ? (
          <article lang="ar" dir="rtl">
            <span className="brand-preview-label">ع</span>
            <div className="brand-preview-art"><b /><em /></div>
            <strong style={{ fontFamily: draft.arabicFont || "Tajawal, Cairo, sans-serif" }}>اجعل خطوتك القادمة مؤثرة.</strong>
            <p style={{ fontFamily: draft.arabicFont || "Tajawal, Cairo, sans-serif" }}>{draft.tone.trim() || "دافئة وواضحة وواثقة."}</p>
          </article>
        ) : null}
        <article lang="en" dir="ltr">
          <span className="brand-preview-label">EN</span>
          <div className="brand-preview-art"><b /><em /></div>
          <strong style={{ fontFamily: draft.latinFont || "Inter, sans-serif" }}>Make the next move count.</strong>
          <p style={{ fontFamily: draft.latinFont || "Inter, sans-serif" }}>{draft.tone.trim() || "Warm, clear, and confident."}</p>
        </article>
        {!ar ? (
          <article lang="ar" dir="rtl">
            <span className="brand-preview-label">ع</span>
            <div className="brand-preview-art"><b /><em /></div>
            <strong style={{ fontFamily: draft.arabicFont || "Tajawal, Cairo, sans-serif" }}>اجعل خطوتك القادمة مؤثرة.</strong>
            <p style={{ fontFamily: draft.arabicFont || "Tajawal, Cairo, sans-serif" }}>{draft.tone.trim() || "دافئة وواضحة وواثقة."}</p>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function BrandKitEditor({ draft, setDraft, locale }: {
  draft: BrandDraft;
  setDraft: Dispatch<SetStateAction<BrandDraft>>;
  locale: CreativeLocale;
}) {
  const ar = locale === "ar";
  const field = <K extends keyof BrandDraft>(key: K, value: BrandDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="brand-editor">
      <div className="brand-editor-controls">
        <fieldset className="brand-fieldset">
          <legend>{t(locale, "brands.palette")}</legend>
          <div className="brand-presets">
            {palettes.map((palette) => (
              <button
                key={palette.id}
                type="button"
                className="brand-preset"
                onClick={() => setDraft((current) => ({ ...current, primary: palette.primary, accent: palette.accent, background: palette.background }))}
              >
                <span><i style={{ background: palette.primary }} /><i style={{ background: palette.accent }} /><i style={{ background: palette.background }} /></span>
                {ar ? palette.ar : palette.en}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="brand-fieldset brand-color-grid">
          <legend>{t(locale, "brands.colors")}</legend>
          <ColorControl label={t(locale, "brands.primaryColor")} value={draft.primary} onChange={(value) => field("primary", value)} locale={locale} />
          <ColorControl label={t(locale, "brands.accentColor")} optional value={draft.accent} onChange={(value) => field("accent", value)} locale={locale} />
          <ColorControl label={t(locale, "brands.backgroundColor")} optional value={draft.background} onChange={(value) => field("background", value)} locale={locale} />
        </fieldset>

        <fieldset className="brand-fieldset">
          <legend>{t(locale, "brands.tone")}</legend>
          <div className="brand-tone-chips">
            {toneChips.map((chip) => <button key={chip.en} type="button" aria-pressed={draft.tone === (ar ? chip.ar : chip.en)} onClick={() => field("tone", ar ? chip.ar : chip.en)}>{ar ? chip.ar : chip.en}</button>)}
          </div>
          <input className="brand-text-input" type="text" value={draft.tone} maxLength={500} placeholder={t(locale, "brands.tonePlaceholder")} aria-label={t(locale, "brands.tone")} onChange={(event) => field("tone", event.target.value)} />
        </fieldset>

        <fieldset className="brand-fieldset">
          <legend>{t(locale, "brands.dialect")}</legend>
          <select className="brand-text-input" value={draft.dialect} onChange={(event) => field("dialect", event.target.value as DialectId)}>
            {DIALECTS.map((dialect) => <option key={dialect.id} value={dialect.id}>{dialectLabel(dialect.id, locale)}</option>)}
          </select>
          <small>{t(locale, "brands.dialectHelper")}</small>
        </fieldset>

        <div className="brand-font-grid">
          <label>{t(locale, "brands.arabicFont")}
            <select value={draft.arabicFont} onChange={(event) => field("arabicFont", event.target.value)}>
              {arabicFonts.map((font) => <option key={font || "default"} value={font}>{font || t(locale, "brands.studioDefault")}</option>)}
            </select>
          </label>
          <label>{t(locale, "brands.latinFont")}
            <select value={draft.latinFont} onChange={(event) => field("latinFont", event.target.value)}>
              {latinFonts.map((font) => <option key={font || "default"} value={font}>{font || t(locale, "brands.studioDefault")}</option>)}
            </select>
          </label>
        </div>
      </div>
      <BrandPreview draft={draft} locale={locale} />
    </div>
  );
}

function VersionSwatches({ colors, locale }: { colors: unknown; locale: CreativeLocale }) {
  const record = colorsRecord(colors);
  const slots = [
    { key: "primary", en: "Primary", ar: "الأساسي", optional: false },
    { key: "accent", en: "Accent", ar: "التمييز", optional: true },
    { key: "background", en: "Background / neutral", ar: "الخلفية / المحايد", optional: true },
  ];
  const known = new Set(slots.map((slot) => slot.key));
  const extras = Object.entries(record).filter(([key]) => !known.has(key));
  return (
    <ul className="brand-version-swatches">
      {slots.map((slot) => {
        const value = record[slot.key] ?? "";
        const saved = COLOR.test(value);
        return (
          <li key={slot.key} className={saved ? "" : "is-unset"}>
            <i style={saved ? { background: value } : undefined} aria-hidden="true" />
            <span>{locale === "ar" ? slot.ar : slot.en}</span>
            <code dir="ltr">{saved ? value.toUpperCase() : locale === "ar" ? (slot.optional ? "غير محدد" : "مطلوب") : (slot.optional ? "Not set" : "Required")}</code>
          </li>
        );
      })}
      {extras.map(([key, value]) => {
        const saved = COLOR.test(value);
        return <li key={key} className={saved ? "" : "is-unset"}><i style={saved ? { background: value } : undefined} aria-hidden="true" /><span>{key}</span><code dir="ltr">{saved ? value.toUpperCase() : locale === "ar" ? "غير محدد" : "Not set"}</code></li>;
      })}
    </ul>
  );
}

export function BrandKitsView({ locale, dir }: { locale: CreativeLocale; dir: "rtl" | "ltr" }) {
  const role = useSessionRole();
  const kits = useCreativeFetch<{ kits: KitRow[] }>(locale, "/api/creative/brand-kits");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<BrandDraft>(emptyDraft);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canAdmin = role === "owner";
  const nameValid = name.trim().length >= 2;
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!valid(draft)) {
      setNotice(t(locale, "brands.invalidColor"));
      return;
    }
    setWorking(true);
    setNotice(null);
    try {
      await api<{ kit_id: string }>(`/api/creative/brand-kits`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-kit") },
        body: JSON.stringify({ name: name.trim(), ...brandPayload(draft) }),
      });
      setNotice(t(locale, "brands.created"));
      setName("");
      setDraft(emptyDraft);
      await kits.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <CreativeSubnav locale={locale} />
      <div className="creative-head"><h1>{t(locale, "brands.title")}</h1></div>
      {canAdmin && (
        <form className="creative-form creative-brand-form" onSubmit={create}>
          <h2>{t(locale, "brands.create")}</h2>
          <label>{t(locale, "brands.name")}<input type="text" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <BrandKitEditor draft={draft} setDraft={setDraft} locale={locale} />
          {!nameValid ? <p className="creative-helper">{t(locale, "brands.nameHelper")}</p> : null}
          {!valid(draft) ? <p className="creative-helper" role="alert">{t(locale, "brands.invalidColor")}</p> : null}
          <button type="submit" className="creative-button" disabled={working || !nameValid || !valid(draft)}>{t(locale, "common.save")}</button>
        </form>
      )}
      {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
      {kits.loading ? <Loading locale={locale} /> : kits.error ? <LoadError locale={locale} error={kits.error} onRetry={kits.reload} />
        : !kits.data?.kits.length ? <p>{t(locale, "brands.empty")}</p>
        : (
          <ul className="creative-grid">
            {kits.data.kits.map((kit) => (
              <li key={kit.kit_id} className="creative-card">
                <h2><Link href={`/creative/brand-kits/${kit.kit_id}`}>{kit.name}</Link></h2>
                <p>{t(locale, "brands.current")}: {formatNumber(kit.current_version, locale)} · {formatNumber(kit.versions, locale)}</p>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export function BrandKitDetailView({ locale, dir, kitId }: { locale: CreativeLocale; dir: "rtl" | "ltr"; kitId: string }) {
  const role = useSessionRole();
  const detail = useCreativeFetch<{ kit: KitDetail; versions: KitVersionRow[] }>(locale, `/api/creative/brand-kits/${kitId}`);
  const [draft, setDraft] = useState<BrandDraft>(emptyDraft);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canAdmin = role === "owner";

  useEffect(() => {
    if (!detail.data) return;
    const current = detail.data.versions.find((version) => version.version === detail.data!.kit.current_version)
      ?? detail.data.versions[detail.data.versions.length - 1];
    setDraft(draftFromVersion(current));
  }, [detail.data]);

  async function newVersion(event: React.FormEvent) {
    event.preventDefault();
    if (!valid(draft)) {
      setNotice(t(locale, "brands.invalidColor"));
      return;
    }
    setWorking(true);
    setNotice(null);
    try {
      await api(`/api/creative/brand-kits/${kitId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-kitver") },
        body: JSON.stringify(brandPayload(draft)),
      });
      setNotice(t(locale, "brands.versionCreated"));
      await detail.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  async function setCurrent(version: number) {
    setWorking(true);
    setNotice(null);
    try {
      await api(`/api/creative/brand-kits/${kitId}/current`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("creative-kitcur") },
        body: JSON.stringify({ version }),
      });
      setNotice(t(locale, "brands.setCurrentDone"));
      await detail.reload();
    } catch (error) {
      setNotice(error instanceof CreativeApiError ? error.code : t(locale, "common.error"));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="creative-page" dir={dir} lang={locale}>
      <CreativeSubnav locale={locale} />
      <p><Link href="/creative/brand-kits">{t(locale, "common.back")}</Link></p>
      {detail.loading ? <Loading locale={locale} /> : detail.error ? <LoadError locale={locale} error={detail.error} onRetry={detail.reload} />
        : detail.data && (
          <>
            <h1>{detail.data.kit.name}</h1>
            <p>{t(locale, "brands.current")}: {formatNumber(detail.data.kit.current_version, locale)}</p>
            <ul className="creative-grid brand-version-grid">
              {detail.data.versions.map((version) => (
                <li key={version.version_id} className="creative-card brand-version-card">
                  <h2>{t(locale, "common.version")}{version.version}</h2>
                  <VersionSwatches colors={version.colors} locale={locale} />
                  <div className="brand-version-details">
                    <span>{t(locale, "brands.tone")}<strong>{version.tone || t(locale, "brands.toneNotSet")}</strong></span>
                    <span>{t(locale, "brands.arabicFont")}<strong>{version.arabic_font || t(locale, "brands.studioDefault")}</strong></span>
                    <span>{t(locale, "brands.latinFont")}<strong>{version.latin_font || t(locale, "brands.studioDefault")}</strong></span>
                    <span>{t(locale, "brands.dialect")}<strong className="brand-dialect-badge">{dialectLabel(dialectFromRules(version.rules), locale)}</strong></span>
                  </div>
                  {canAdmin && version.version !== detail.data!.kit.current_version && (
                    <button type="button" className="creative-button creative-button-secondary" disabled={working} onClick={() => setCurrent(version.version)}>
                      {t(locale, "brands.setCurrent")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canAdmin && (
              <form className="creative-form creative-brand-form" onSubmit={newVersion}>
                <h2>{t(locale, "brands.newVersion")}</h2>
                <BrandKitEditor draft={draft} setDraft={setDraft} locale={locale} />
                {!valid(draft) ? <p className="creative-helper" role="alert">{t(locale, "brands.invalidColor")}</p> : null}
                <button type="submit" className="creative-button" disabled={working || !valid(draft)}>{t(locale, "common.save")}</button>
              </form>
            )}
            {notice && <div className="creative-notice" role="status"><p>{notice}</p></div>}
          </>
        )}
    </div>
  );
}
