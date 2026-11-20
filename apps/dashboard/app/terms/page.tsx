import type { Metadata } from "next";

import { PublicTermsPage } from "@/components/public-pages";
import { creativeLocale } from "@/lib/creative-locale";
import { getAppOrigin, isSplitDomainMode } from "@/lib/public-urls";
import { buildPublicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await creativeLocale();
  return buildPublicPageMetadata("terms", locale);
}

export default async function TermsPage() {
  const { locale } = await creativeLocale();
  const appOrigin = isSplitDomainMode() ? getAppOrigin() : "";
  return <PublicTermsPage locale={locale} appOrigin={appOrigin} />;
}
