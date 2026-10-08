import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { CreativeOverview } from "@/components/creative/creative-overview";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Creative Studio" };

export default async function CreativePage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <CreativeOverview locale={locale} dir={dir} />
    </>
  );
}
