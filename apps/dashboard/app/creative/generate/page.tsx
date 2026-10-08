import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { GenerateView } from "@/components/creative/generate-view";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "New Image" };

export default async function CreativeGeneratePage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <GenerateView locale={locale} dir={dir} />
    </>
  );
}
