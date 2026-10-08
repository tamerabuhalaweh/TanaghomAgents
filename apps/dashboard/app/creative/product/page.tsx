import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { ProductView } from "@/components/creative/product-view";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Product Studio" };

export default async function CreativeProductPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <ProductView locale={locale} dir={dir} />
    </>
  );
}
