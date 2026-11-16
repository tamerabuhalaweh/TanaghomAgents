import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { ProductView } from "@/components/creative/product-view";

export const metadata: Metadata = { title: "Product Studio" };

export default async function CreativeProductPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <ProductView locale={locale} dir={dir} />
    </>
  );
}
