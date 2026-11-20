import type { Metadata } from "next";

import { PublicPricingPage } from "@/components/public-pages";
import { creativeLocale } from "@/lib/creative-locale";
import { getAppOrigin, isSplitDomainMode } from "@/lib/public-urls";
import { database } from "@/lib/server/database";
import { loadPublicLaunchOffer } from "@/lib/server/launch-control";

export const metadata: Metadata = { title: "Pricing" };

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
  return <PublicPricingPage locale={locale} launch100Active={launch100Active} cohortFull={cohortFull} appOrigin={appOrigin} />;
}
