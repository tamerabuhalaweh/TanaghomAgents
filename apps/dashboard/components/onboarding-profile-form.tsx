"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import type { OnboardingCopy } from "@/lib/i18n/onboarding";
import { ONBOARDING_INDUSTRIES, type OnboardingIndustry } from "@/lib/onboarding-industries";
import type { OnboardingProfile } from "@/lib/onboarding-types";
import { tenantDisplayName } from "@/lib/tenant-name";

type Status = "loading" | "ready" | "saving" | "saved" | "error" | "load_error";

export function OnboardingProfileForm({ copy, locale }: { copy: OnboardingCopy; locale: "en" | "ar" }) {
  const [canonicalName, setCanonicalName] = useState("");
  const [businessNameEn, setBusinessNameEn] = useState("");
  const [businessNameAr, setBusinessNameAr] = useState("");
  const [industry, setIndustry] = useState<OnboardingIndustry | "">("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let active = true;
    void authenticatedFetch("/api/settings/onboarding", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("onboarding_profile_unavailable");
        return await response.json() as OnboardingProfile;
      })
      .then((profile) => {
        if (!active) return;
        setCanonicalName(profile.name);
        setBusinessNameEn(profile.businessNameEn ?? "");
        setBusinessNameAr(profile.businessNameAr ?? "");
        setIndustry(profile.industry ?? "");
        setLocation(profile.location ?? "");
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("load_error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    const response = await authenticatedFetch("/api/settings/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessNameEn,
        businessNameAr,
        industry: industry || null,
        location,
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setStatus("error");
      return;
    }
    const profile = await response.json() as OnboardingProfile;
    setCanonicalName(profile.name);
    setStatus("saved");
    window.dispatchEvent(new Event("tanaghom:identity-changed"));
  }

  if (status === "loading") {
    return <p className="onboarding-message" aria-live="polite">{copy.loading}</p>;
  }
  if (status === "load_error") {
    return <p className="onboarding-message" role="alert">{copy.loadError}</p>;
  }

  const preview = { name: canonicalName, businessNameEn, businessNameAr };

  return (
    <form className="onboarding-form" onSubmit={submit} dir={locale === "ar" ? "rtl" : "ltr"}>
      <p className="onboarding-step">{copy.stepLabel}</p>

      <div className="onboarding-grid">
        <label className="onboarding-field">
          <span>{copy.englishNameLabel}</span>
          <input
            type="text"
            value={businessNameEn}
            minLength={businessNameEn ? 2 : undefined}
            maxLength={120}
            onChange={(event) => setBusinessNameEn(event.target.value)}
            dir="ltr"
          />
          <small>{copy.englishNameHint}</small>
        </label>

        <label className="onboarding-field">
          <span>{copy.arabicNameLabel}</span>
          <input
            type="text"
            value={businessNameAr}
            minLength={businessNameAr ? 2 : undefined}
            maxLength={120}
            onChange={(event) => setBusinessNameAr(event.target.value)}
            dir="rtl"
          />
          <small>{copy.arabicNameHint}</small>
        </label>

        <label className="onboarding-field">
          <span>{copy.industryLabel}</span>
          <select
            value={industry}
            onChange={(event) => setIndustry(event.target.value as OnboardingIndustry | "")}
          >
            <option value="">{copy.industryPlaceholder}</option>
            {ONBOARDING_INDUSTRIES.map((value) => (
              <option key={value} value={value}>{copy.industries[value]}</option>
            ))}
          </select>
        </label>

        <label className="onboarding-field">
          <span>{copy.locationLabel}</span>
          <input
            type="text"
            value={location}
            minLength={location ? 2 : undefined}
            maxLength={160}
            onChange={(event) => setLocation(event.target.value)}
          />
          <small>{copy.locationPlaceholder}</small>
        </label>
      </div>

      <div className="onboarding-preview" aria-live="polite">
        <strong>{copy.previewTitle}</strong>
        <dl>
          <div><dt>{copy.previewEn}</dt><dd dir="ltr">{tenantDisplayName(preview, "en")}</dd></div>
          <div><dt>{copy.previewAr}</dt><dd dir="rtl">{tenantDisplayName(preview, "ar")}</dd></div>
        </dl>
        <p>{copy.canonicalNote}</p>
      </div>

      <p className="onboarding-message" role={status === "error" ? "alert" : undefined} aria-live="polite">
        {status === "error" ? copy.error : status === "saved" ? copy.saved : ""}
      </p>

      <button className="onboarding-submit" type="submit" disabled={status === "saving"}>
        <span>{status === "saving" ? copy.saving : copy.save}</span>
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    </form>
  );
}
