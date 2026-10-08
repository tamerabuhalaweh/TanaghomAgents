import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { BrandKitDetailView } from "@/components/creative/brand-kit-views";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Brand Kit" };

export default async function CreativeBrandKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <BrandKitDetailView locale={locale} dir={dir} kitId={id} />
    </>
  );
}
