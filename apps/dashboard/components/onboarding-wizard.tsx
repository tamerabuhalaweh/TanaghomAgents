"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { OnboardingBrandStep } from "@/components/onboarding-brand-step";
import { OnboardingKnowledgeStep } from "@/components/onboarding-knowledge-step";
import { OnboardingProfileForm } from "@/components/onboarding-profile-form";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import type { OnboardingCopy } from "@/lib/i18n/onboarding";
import type { OnboardingProfile } from "@/lib/onboarding-types";

type Step = 1 | 2 | 3 | 4;
type FinishStatus = "idle" | "saving" | "done" | "error";
type CheckState = { loading: boolean; error: boolean; saved: [boolean, boolean, boolean] };

export function OnboardingWizard({ copy, locale }: { copy: OnboardingCopy; locale: "en" | "ar" }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [finishStatus, setFinishStatus] = useState<FinishStatus>("idle");
  const [checklist, setChecklist] = useState<CheckState>({ loading: true, error: false, saved: [false, false, false] });

  const steps: Array<{ id: Step; label: string }> = [
    { id: 1, label: copy.profileTitle },
    { id: 2, label: copy.brandTitle },
    { id: 3, label: copy.knowledgeTitle },
    { id: 4, label: copy.readyTabTitle },
  ];

  useEffect(() => {
    if (step !== 4) return;
    let active = true;
    setChecklist({ loading: true, error: false, saved: [false, false, false] });
    void Promise.all([
      authenticatedFetch("/api/settings/onboarding", { cache: "no-store" }),
      authenticatedFetch("/api/creative/brand-kits", { cache: "no-store" }),
      authenticatedFetch("/api/admin/knowledge", { cache: "no-store" }),
    ])
      .then(async ([profileResponse, kitsResponse, knowledgeResponse]) => {
        if (!active) return;
        if (!profileResponse.ok || !kitsResponse.ok || !knowledgeResponse.ok) {
          setChecklist({ loading: false, error: true, saved: [false, false, false] });
          return;
        }
        const [profile, kits, knowledge] = await Promise.all([
          profileResponse.json() as Promise<OnboardingProfile>,
          kitsResponse.json() as Promise<{ kits?: Array<{ kit_id: string }> }>,
          knowledgeResponse.json() as Promise<{ counts?: { sources?: number } }>,
        ]);
        if (!active) return;
        const profileSaved = Boolean(profile.completedAt || profile.businessNameEn || profile.businessNameAr || profile.industry || profile.location);
        setChecklist({
          loading: false,
          error: false,
          saved: [profileSaved, Boolean(kits.kits?.length), (knowledge.counts?.sources ?? 0) > 0],
        });
      })
      .catch(() => {
        if (active) setChecklist({ loading: false, error: true, saved: [false, false, false] });
      });
    return () => {
      active = false;
    };
  }, [step]);

  async function finish() {
    if (finishStatus === "saving" || finishStatus === "done") return;
    setFinishStatus("saving");
    const response = await authenticatedFetch("/api/settings/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ complete: true }),
    }).catch(() => null);
    if (!response?.ok) {
      setFinishStatus("error");
      return;
    }
    setFinishStatus("done");
    router.push("/");
  }

  return (
    <div className="onboarding-wizard" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
      <nav className="onboarding-steps" aria-label={copy.stepperLabel}>
        {steps.map((item) => (
          <button
            key={item.id}
            type="button"
            className="onboarding-tab"
            aria-current={step === item.id ? "step" : undefined}
            onClick={() => setStep(item.id)}
          >
            <span className="onboarding-tab-index" aria-hidden="true">{item.id}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {step === 1 ? <OnboardingProfileForm copy={copy} locale={locale} /> : null}
      {step === 2 ? <OnboardingBrandStep copy={copy} locale={locale} /> : null}
      {step === 3 ? <OnboardingKnowledgeStep copy={copy} locale={locale} /> : null}
      {step === 4 ? (
        <section className="onboarding-preview" aria-live="polite">
          <p className="onboarding-step">{copy.step4Label}</p>
          <h2 className="onboarding-title">{copy.readyTitle}</h2>
          <p className="onboarding-lede">{copy.readyLede}</p>
          <ul className="onboarding-checklist">
            {copy.readyChecklist.map((item, index) => {
              const ready = checklist.saved[index];
              return (
                <li key={item} className={ready ? "onboarding-check-ready" : ""}>
                  {ready ? <CheckCircle2 size={19} aria-hidden="true" /> : <Circle size={19} aria-hidden="true" />}
                  <span>
                    <strong>{item}</strong>
                    <small>{ready ? copy.checklistSaved : checklist.loading ? copy.checklistChecking : copy.checklistPending}</small>
                  </span>
                  {!ready && !checklist.loading ? <button type="button" className="onboarding-link" onClick={() => setStep((index + 1) as Step)}>{copy.checklistActions[index]}</button> : null}
                </li>
              );
            })}
          </ul>
          {checklist.error ? <p className="onboarding-message" role="alert">{copy.checklistError}</p> : null}
          <p className="onboarding-message" role={finishStatus === "error" ? "alert" : undefined}>
            {finishStatus === "done" ? copy.completed : finishStatus === "error" ? copy.completeError : ""}
          </p>
        </section>
      ) : null}

      <div className="onboarding-nav">
        {step > 1 ? (
          <button type="button" className="onboarding-back" onClick={() => setStep((step - 1) as Step)}>
            {copy.back}
          </button>
        ) : <span />}
        {step < 4 ? (
          <button type="button" className="onboarding-submit" onClick={() => setStep((step + 1) as Step)}>
            {copy.next}
          </button>
        ) : (
          <button
            type="button"
            className="onboarding-submit"
            onClick={finishStatus === "done" ? () => router.push("/") : finish}
            disabled={finishStatus === "saving"}
          >
            {finishStatus === "done" ? copy.finish : finishStatus === "saving" ? copy.finishing : copy.finishSetup}
          </button>
        )}
      </div>
    </div>
  );
}
