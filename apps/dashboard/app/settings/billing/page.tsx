import type { Metadata } from "next";

import { BillingSettings } from "@/components/billing-settings";
import { SettingsNavigation } from "@/components/settings-navigation";
import { creativeLocale } from "@/lib/creative-locale";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <div className="page-stack" dir={dir} lang={locale}>
      <SettingsNavigation />
      <BillingSettings />
    </div>
  );
}
