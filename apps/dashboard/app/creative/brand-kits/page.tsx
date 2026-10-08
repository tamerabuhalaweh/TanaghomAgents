import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { BrandKitsView } from "@/components/creative/brand-kit-views";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Brand Kits" };

export default async function CreativeBrandKitsPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <BrandKitsView locale={locale} dir={dir} />
    </>
  );
}
