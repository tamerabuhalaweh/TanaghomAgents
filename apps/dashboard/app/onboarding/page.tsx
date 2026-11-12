import type { Metadata } from "next";

import { OnboardingWizard } from "@/components/onboarding-wizard";
import { PageHeading } from "@/components/page-heading";
import { creativeLocale } from "@/lib/creative-locale";
import { onboardingCopy } from "@/lib/i18n/onboarding";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const { locale, dir } = await creativeLocale();
  const copy = onboardingCopy(locale);
  return (
    <div className="page-stack" dir={dir} lang={locale}>
      <PageHeading title={copy.title} description={copy.lede} />
      <OnboardingWizard copy={copy} locale={locale} />
    </div>
  );
}
