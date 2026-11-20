import type { Metadata } from "next";

import { PublicPricingPage } from "@/components/public-pages";
import { creativeLocale } from "@/lib/creative-locale";
import { getAppOrigin, isSplitDomainMode } from "@/lib/public-urls";
import { buildPublicPageMetadata, pricingJsonLd, serializeJsonLd } from "@/lib/seo";
import { database } from "@/lib/server/database";
import { loadPublicLaunchOffer } from "@/lib/server/launch-control";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await creativeLocale();
  return buildPublicPageMetadata("pricing", locale);
}

export default async function PricingPage() {
  const { locale } = await creativeLocale();
  let launch100Active = true;
  let cohortFull = false;
  try {
    const launch = await loadPublicLaunchOffer(database());
    launch100Active = launch.launch100_active;
    cohortFull = launch.cohort_full;
  } catch {}
  const appOrigin = isSplitDomainMode() ? getAppOrigin() : "";
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(pricingJsonLd(locale)) }}
      />
      <PublicPricingPage locale={locale} launch100Active={launch100Active} cohortFull={cohortFull} appOrigin={appOrigin} />
    </>
  );
}
