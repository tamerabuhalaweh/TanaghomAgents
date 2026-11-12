"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import type { OnboardingCopy } from "@/lib/i18n/onboarding";
import type { OnboardingProfile } from "@/lib/onboarding-types";
import { tenantDisplayName } from "@/lib/tenant-name";

interface BrandKitRow {
  kit_id: string;
  name: string;
  current_version: number;
  versions: number;
}

type Status = "loading" | "empty" | "existing" | "disabled" | "load_error" | "saving" | "saved" | "error";

const COLOR = /^#[0-9a-f]{6}$/i;

function idempotencyKey() {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `onboarding-brand-${suffix}`.slice(0, 128);
}

export function OnboardingBrandStep({ copy, locale }: { copy: OnboardingCopy; locale: "en" | "ar" }) {
  const [status, setStatus] = useState<Status>("loading");
  const [existing, setExisting] = useState<BrandKitRow | null>(null);
  const [name, setName] = useState("");
  const [primary, setPrimary] = useState("#1F6F5C");
  const [accent, setAccent] = useState("");
  const [tone, setTone] = useState("");
  const [arabicFont, setArabicFont] = useState("");
  const [latinFont, setLatinFont] = useState("");
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
        if (kits.kits?.length) {
          setExisting(kits.kits[0]);
          setStatus("existing");
          return;
        }
        if (profileResponse.ok) {
          const profile = await profileResponse.json() as OnboardingProfile;
          if (active) setName(tenantDisplayName(profile, locale));
        }
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
    const response = await authenticatedFetch("/api/creative/brand-kits", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
      body: JSON.stringify({
        name: name.trim(),
        colors,
        tone: tone.trim() || null,
        arabic_font: arabicFont.trim() || null,
        latin_font: latinFont.trim() || null,
      }),
    }).catch(() => null);
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
  if (status === "existing" && existing) {
    return (
      <section className="onboarding-form">
        {stepHeader}
        <div className="onboarding-preview">
          <strong>{copy.brandExisting}</strong>
          <dl>
            <div><dt>{copy.brandNameLabel}</dt><dd>{existing.name}</dd></div>
            <div><dt>{copy.previewTitle}</dt><dd>v{existing.current_version} · {existing.versions}</dd></div>
          </dl>
          <p>{copy.brandExistingHint}</p>
        </div>
        <Link className="onboarding-link" href="/creative/brand-kits">{copy.brandOpen}</Link>
      </section>
    );
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
      <div className="onboarding-grid">
        <label className="onboarding-field">
          <span>{copy.brandNameLabel}</span>
          <input type="text" value={name} required minLength={2} maxLength={120} onChange={(event) => setName(event.target.value)} />
          <small>{copy.brandNameHint}</small>
        </label>

        <label className="onboarding-field">
          <span>{copy.toneLabel}</span>
          <input type="text" value={tone} maxLength={500} placeholder={copy.tonePlaceholder} onChange={(event) => setTone(event.target.value)} />
        </label>

        <div className="onboarding-field">
          <span>{copy.primaryColorLabel}</span>
          <div className="onboarding-color">
            <input type="color" value={COLOR.test(primary) ? primary : "#1f6f5c"} aria-label={copy.primaryColorLabel} onChange={(event) => setPrimary(event.target.value.toUpperCase())} />
            <input type="text" value={primary} maxLength={7} dir="ltr" aria-label={copy.primaryColorLabel} onChange={(event) => setPrimary(event.target.value)} />
          </div>
        </div>

        <div className="onboarding-field">
          <span>{copy.accentColorLabel}</span>
          <div className="onboarding-color">
            <input type="color" value={COLOR.test(accent) ? accent : "#d9a441"} aria-label={copy.accentColorLabel} onChange={(event) => setAccent(event.target.value.toUpperCase())} />
            <input type="text" value={accent} maxLength={7} dir="ltr" aria-label={copy.accentColorLabel} onChange={(event) => setAccent(event.target.value)} />
          </div>
        </div>

        <label className="onboarding-field">
          <span>{copy.arabicFontLabel}</span>
          <input type="text" value={arabicFont} maxLength={120} placeholder={copy.fontPlaceholder} onChange={(event) => setArabicFont(event.target.value)} />
        </label>

        <label className="onboarding-field">
          <span>{copy.latinFontLabel}</span>
          <input type="text" value={latinFont} maxLength={120} placeholder={copy.fontPlaceholder} onChange={(event) => setLatinFont(event.target.value)} />
        </label>
      </div>

      <div className="onboarding-preview" aria-live="polite">
        <strong>{name.trim() || copy.brandTitle}</strong>
        <div className="onboarding-swatches">
          <span style={{ background: COLOR.test(primary) ? primary : "#1f6f5c" }} title={primary} />
          {accent && COLOR.test(accent) ? <span style={{ background: accent }} title={accent} /> : null}
        </div>
        <p>{tone.trim() || copy.tonePlaceholder}</p>
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
