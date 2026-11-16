import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { BrandKitsView } from "@/components/creative/brand-kit-views";

export const metadata: Metadata = { title: "Brand Kits" };

export default async function CreativeBrandKitsPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <BrandKitsView locale={locale} dir={dir} />
    </>
  );
}
