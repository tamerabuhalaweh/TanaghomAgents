import type { Metadata } from "next";

import { SecuritySettings } from "@/components/security-settings";
import { SessionList } from "@/components/session-list";
import { SettingsNavigation } from "@/components/settings-navigation";
import { creativeLocale } from "@/lib/creative-locale";
import { authCopy } from "@/lib/i18n/auth";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <div className="page-stack" dir={dir} lang={locale}>
      <SettingsNavigation />
      <SecuritySettings />
      <SessionList copy={authCopy(locale)} />
    </div>
  );
}
