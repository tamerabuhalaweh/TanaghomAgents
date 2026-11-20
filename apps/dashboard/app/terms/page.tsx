import type { Metadata } from "next";

import { PublicTermsPage } from "@/components/public-pages";
import { creativeLocale } from "@/lib/creative-locale";
import { getAppOrigin, isSplitDomainMode } from "@/lib/public-urls";

export const metadata: Metadata = { title: "Terms" };

export default async function TermsPage() {
  const { locale } = await creativeLocale();
  const appOrigin = isSplitDomainMode() ? getAppOrigin() : "";
  return <PublicTermsPage locale={locale} appOrigin={appOrigin} />;
}
