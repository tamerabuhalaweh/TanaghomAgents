import type { Metadata } from "next";

import { PublicPrivacyPage } from "@/components/public-pages";
import { creativeLocale } from "@/lib/creative-locale";
import { getAppOrigin, isSplitDomainMode } from "@/lib/public-urls";

export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage() {
  const { locale } = await creativeLocale();
  const appOrigin = isSplitDomainMode() ? getAppOrigin() : "";
  return <PublicPrivacyPage locale={locale} appOrigin={appOrigin} />;
}
