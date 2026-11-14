import type { Metadata } from "next";

import { PublicTermsPage } from "@/components/public-pages";
import { creativeLocale } from "@/lib/creative-locale";

export const metadata: Metadata = { title: "Terms" };

export default async function TermsPage() {
  const { locale } = await creativeLocale();
  return <PublicTermsPage locale={locale} />;
}
