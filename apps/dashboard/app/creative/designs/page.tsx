import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { DesignsView } from "@/components/creative/designs-view";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Designs" };

export default async function CreativeDesignsPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <DesignsView locale={locale} dir={dir} />
    </>
  );
}
