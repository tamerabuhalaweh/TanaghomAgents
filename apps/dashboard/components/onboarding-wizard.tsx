"use client";

import Link from "next/link";
import { useState } from "react";

import { OnboardingBrandStep } from "@/components/onboarding-brand-step";
import { OnboardingKnowledgeStep } from "@/components/onboarding-knowledge-step";
import { OnboardingProfileForm } from "@/components/onboarding-profile-form";
import type { OnboardingCopy } from "@/lib/i18n/onboarding";

type Step = 1 | 2 | 3;

export function OnboardingWizard({ copy, locale }: { copy: OnboardingCopy; locale: "en" | "ar" }) {
  const [step, setStep] = useState<Step>(1);

  const steps: Array<{ id: Step; label: string }> = [
    { id: 1, label: copy.profileTitle },
    { id: 2, label: copy.brandTitle },
    { id: 3, label: copy.knowledgeTitle },
  ];

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

      <div className="onboarding-nav">
        {step > 1 ? (
          <button type="button" className="onboarding-back" onClick={() => setStep((step - 1) as Step)}>
            {copy.back}
          </button>
        ) : <span />}
        {step < 3 ? (
          <button type="button" className="onboarding-submit" onClick={() => setStep((step + 1) as Step)}>
            {copy.next}
          </button>
        ) : (
          <Link className="onboarding-link" href="/">{copy.finish}</Link>
        )}
      </div>
    </div>
  );
}
