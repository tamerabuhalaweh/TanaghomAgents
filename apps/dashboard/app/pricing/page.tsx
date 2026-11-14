import type { Metadata } from "next";

import { PublicPricingPage } from "@/components/public-pages";
import { creativeLocale } from "@/lib/creative-locale";

export const metadata: Metadata = { title: "Pricing" };

export default async function PricingPage() {
  const { locale } = await creativeLocale();
  return <PublicPricingPage locale={locale} />;
}
