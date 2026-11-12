import type { Metadata } from "next";

import { OnboardingProfileForm } from "@/components/onboarding-profile-form";
import { PageHeading } from "@/components/page-heading";
import { creativeLocale } from "@/lib/creative-locale";
import { onboardingCopy } from "@/lib/i18n/onboarding";

export const metadata: Metadata = { title: "Business profile" };

export default async function OnboardingPage() {
  const { locale, dir } = await creativeLocale();
  const copy = onboardingCopy(locale);
  return (
    <div className="page-stack" dir={dir} lang={locale}>
      <PageHeading title={copy.title} description={copy.lede} />
      <OnboardingProfileForm copy={copy} locale={locale} />
    </div>
  );
}
