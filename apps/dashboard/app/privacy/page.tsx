import type { Metadata } from "next";

import { PublicPrivacyPage } from "@/components/public-pages";
import { creativeLocale } from "@/lib/creative-locale";
import { getAppOrigin, isSplitDomainMode } from "@/lib/public-urls";
import { buildPublicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await creativeLocale();
  return buildPublicPageMetadata("privacy", locale);
}

export default async function PrivacyPage() {
  const { locale } = await creativeLocale();
  const appOrigin = isSplitDomainMode() ? getAppOrigin() : "";
  return <PublicPrivacyPage locale={locale} appOrigin={appOrigin} />;
}
