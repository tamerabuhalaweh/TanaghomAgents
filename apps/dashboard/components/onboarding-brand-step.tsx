"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { DIALECTS, dialectLabel, inferDialectFromLocation, normalizeDialect, type DialectId } from "@/lib/i18n/dialects";
import type { OnboardingCopy } from "@/lib/i18n/onboarding";
import { normalizeDigits } from "@/lib/i18n/format";
import type { OnboardingProfile } from "@/lib/onboarding-types";
import { tenantDisplayName } from "@/lib/tenant-name";

interface BrandKitRow {
  kit_id: string;
  name: string;
  current_version: number;
  versions: number;
}

interface BrandKitVersion {
  version: number;
  colors: Record<string, string> | null;
  tone: string | null;
  arabic_font: string | null;
  latin_font: string | null;
  rules: unknown;
}

type Status = "loading" | "empty" | "existing" | "disabled" | "load_error" | "saving" | "saved" | "error";

const COLOR = /^#[0-9a-f]{6}$/i;

function idempotencyKey() {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `onboarding-brand-${suffix}`.slice(0, 128);
}

function applyVersion(version: BrandKitVersion | undefined, set: {
  setPrimary: (value: string) => void;
  setAccent: (value: string) => void;
  setTone: (value: string) => void;
  setArabicFont: (value: string) => void;
  setLatinFont: (value: string) => void;
  setDialect: (value: DialectId) => void;
}) {
  if (!version) return;
  const primary = version.colors?.primary;
  const accent = version.colors?.accent;
  if (primary && COLOR.test(primary)) set.setPrimary(primary.toUpperCase());
  if (accent && COLOR.test(accent)) set.setAccent(accent.toUpperCase());
  set.setTone(version.tone ?? "");
  set.setArabicFont(version.arabic_font ?? "");
  set.setLatinFont(version.latin_font ?? "");
  const rules = version.rules && typeof version.rules === "object" && !Array.isArray(version.rules)
    ? version.rules as Record<string, unknown>
    : {};
  const dialect = normalizeDialect(rules.arabic_dialect);
  if (dialect) set.setDialect(dialect);
}

export function OnboardingBrandStep({ copy, locale }: { copy: OnboardingCopy; locale: "en" | "ar" }) {
  const [status, setStatus] = useState<Status>("loading");
  const [existing, setExisting] = useState<BrandKitRow | null>(null);
  const [name, setName] = useState("");
  const [primary, setPrimary] = useState("#1F6F5C");
  const [accent, setAccent] = useState("#D9A441");
  const [tone, setTone] = useState("");
  const [arabicFont, setArabicFont] = useState("");
  const [latinFont, setLatinFont] = useState("");
  const [dialect, setDialect] = useState<DialectId>("msa");
  const [rules, setRules] = useState<Record<string, unknown>>({});
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      authenticatedFetch("/api/creative/brand-kits", { cache: "no-store" }),
      authenticatedFetch("/api/settings/onboarding", { cache: "no-store" }),
    ])
      .then(async ([kitsResponse, profileResponse]) => {
        if (!active) return;
        if (kitsResponse.status === 503) {
          setStatus("disabled");
          return;
        }
        if (!kitsResponse.ok) {
          setStatus("load_error");
          return;
        }
        const kits = await kitsResponse.json() as { kits?: BrandKitRow[] };
        if (!active) return;
        let profile: OnboardingProfile | null = null;
        if (profileResponse.ok) profile = await profileResponse.json() as OnboardingProfile;
        if (!active) return;
        const inferredDialect = inferDialectFromLocation(profile?.location);
        if (kits.kits?.length) {
          const kit = kits.kits[0];
          setExisting(kit);
          setName(kit.name);
          const detailResponse = await authenticatedFetch(`/api/creative/brand-kits/${kit.kit_id}`, { cache: "no-store" });
          if (!active) return;
          if (detailResponse.ok) {
            const detail = await detailResponse.json() as { versions?: BrandKitVersion[] };
            const versions = detail.versions ?? [];
            const current = versions.find((version) => version.version === kit.current_version) ?? versions[versions.length - 1];
            applyVersion(current, { setPrimary, setAccent, setTone, setArabicFont, setLatinFont, setDialect });
            const existingRules = current?.rules && typeof current.rules === "object" && !Array.isArray(current.rules)
              ? current.rules as Record<string, unknown>
              : {};
            setRules(existingRules);
          }
          setDialect((current) => current === "msa" ? inferredDialect : current);
          if (active) setStatus("existing");
          return;
        }
        if (profile) setName(tenantDisplayName(profile, locale));
        if (active) setDialect(inferredDialect);
        if (active) setStatus("empty");
      })
      .catch(() => {
        if (active) setStatus("load_error");
      });
    return () => {
      active = false;
    };
  }, [locale]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!COLOR.test(primary) || (accent && !COLOR.test(accent))) {
      setProblem(copy.brandInvalidColor);
      return;
    }
    setProblem("");
    setStatus("saving");
    const colors: Record<string, string> = { primary };
    if (accent) colors.accent = accent;
    const response = await authenticatedFetch(
      existing
        ? `/api/creative/brand-kits/${existing.kit_id}/versions`
        : "/api/creative/brand-kits",
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
        body: JSON.stringify({
          name: name.trim(),
          colors,
          tone: tone.trim() || null,
          arabic_font: arabicFont.trim() || null,
          latin_font: latinFont.trim() || null,
          rules: { ...rules, arabic_dialect: dialect },
        }),
      },
    ).catch(() => null);
    if (!response) {
      setStatus("error");
      return;
    }
    if (response.status === 503) {
      setStatus("disabled");
      return;
    }
    if (!response.ok) {
      setStatus("error");
      return;
    }
    setStatus("saved");
  }

  const stepHeader = (
    <>
      <p className="onboarding-step">{copy.step2Label}</p>
      <h2 className="onboarding-title">{copy.brandTitle}</h2>
      <p className="onboarding-lede">{copy.brandLede}</p>
    </>
  );

  if (status === "loading") {
    return <section className="onboarding-form">{stepHeader}<p className="onboarding-message" aria-live="polite">{copy.brandLoading}</p></section>;
  }
  if (status === "disabled") {
    return <section className="onboarding-form">{stepHeader}<p className="onboarding-message" role="status">{copy.brandDisabled}</p></section>;
  }
  if (status === "load_error") {
    return <section className="onboarding-form">{stepHeader}<p className="onboarding-message" role="alert">{copy.brandError}</p></section>;
  }
  if (status === "saved") {
    return (
      <section className="onboarding-form">
        {stepHeader}
        <p className="onboarding-message" role="status" aria-live="polite">{copy.brandSaved}</p>
        <Link className="onboarding-link" href="/creative/brand-kits">{copy.brandOpen}</Link>
      </section>
    );
  }

  return (
    <form className="onboarding-form" onSubmit={submit} dir={locale === "ar" ? "rtl" : "ltr"}>
      {stepHeader}
      {status === "existing" ? <p className="onboarding-note"><strong>{copy.brandExisting}.</strong> {copy.brandExistingHint}</p> : null}
      <div className="onboarding-grid">
        <label className="onboarding-field">
          <span>{copy.brandNameLabel}</span>
          <input type="text" dir="auto" value={name} required minLength={2} maxLength={120} onChange={(event) => setName(event.target.value)} />
          <small>{copy.brandNameHint}</small>
        </label>

        <label className="onboarding-field">
          <span>{copy.toneLabel}</span>
          <input type="text" dir="auto" value={tone} maxLength={500} placeholder={copy.tonePlaceholder} onChange={(event) => setTone(event.target.value)} />
        </label>

        <div className="onboarding-field">
          <span>{copy.primaryColorLabel}</span>
          <div className="onboarding-color">
            <input type="color" value={COLOR.test(primary) ? primary : "#1f6f5c"} aria-label={copy.primaryColorLabel} onChange={(event) => setPrimary(event.target.value.toUpperCase())} />
            <input type="text" value={primary} maxLength={7} dir="ltr" aria-label={copy.primaryColorLabel} onChange={(event) => setPrimary(normalizeDigits(event.target.value))} />
          </div>
        </div>

        <div className="onboarding-field">
          <span>{copy.accentColorLabel}</span>
          <div className="onboarding-color">
            <input type="color" value={COLOR.test(accent) ? accent : "#D9A441"} aria-label={copy.accentColorLabel} onChange={(event) => setAccent(event.target.value.toUpperCase())} />
            <input
              type="text"
              value={accent}
              maxLength={7}
              dir="ltr"
              aria-label={copy.accentColorLabel}
              onChange={(event) => setAccent(normalizeDigits(event.target.value))}
              onBlur={() => { if (!accent) setAccent("#D9A441"); }}
            />
          </div>
        </div>

        <label className="onboarding-field">
          <span>{copy.dialectLabel}</span>
          <select value={dialect} onChange={(event) => setDialect(event.target.value as DialectId)}>
            {DIALECTS.map((item) => <option key={item.id} value={item.id}>{dialectLabel(item.id, locale)}</option>)}
          </select>
          <small>{copy.dialectHint}</small>
        </label>

        <label className="onboarding-field">
          <span>{copy.arabicFontLabel}</span>
          <input type="text" dir="auto" value={arabicFont} maxLength={120} placeholder={copy.fontPlaceholder} onChange={(event) => setArabicFont(event.target.value)} />
        </label>

        <label className="onboarding-field">
          <span>{copy.latinFontLabel}</span>
          <input type="text" dir="ltr" value={latinFont} maxLength={120} placeholder={copy.fontPlaceholder} onChange={(event) => setLatinFont(event.target.value)} />
        </label>
      </div>

      <div className="onboarding-preview" aria-live="polite">
        <strong>{name.trim() || copy.brandTitle}</strong>
        <div className="onboarding-swatches">
          <span style={{ background: COLOR.test(primary) ? primary : "#1f6f5c" }} title={primary} />
          {accent && COLOR.test(accent) ? <span style={{ background: accent }} title={accent} /> : null}
        </div>
        <p>{tone.trim() || copy.tonePlaceholder}</p>
        <span className="onboarding-dialect-badge">{copy.dialectPreview}: <strong>{dialectLabel(dialect, locale)}</strong></span>
      </div>

      <p className="onboarding-message" role={problem || status === "error" ? "alert" : undefined} aria-live="polite">
        {problem || (status === "error" ? copy.brandError : "")}
      </p>

      <button className="onboarding-submit" type="submit" disabled={status === "saving" || name.trim().length < 2}>
        {status === "saving" ? copy.brandSaving : copy.brandSave}
      </button>
    </form>
  );
}
