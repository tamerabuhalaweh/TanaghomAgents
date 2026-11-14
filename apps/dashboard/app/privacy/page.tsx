import type { Metadata } from "next";

import { PublicPrivacyPage } from "@/components/public-pages";
import { creativeLocale } from "@/lib/creative-locale";

export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage() {
  const { locale } = await creativeLocale();
  return <PublicPrivacyPage locale={locale} />;
}
