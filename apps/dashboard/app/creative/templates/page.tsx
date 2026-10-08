import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { TemplatesView } from "@/components/creative/templates-view";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Creative Templates" };

export default async function CreativeTemplatesPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <TemplatesView locale={locale} dir={dir} />
    </>
  );
}
