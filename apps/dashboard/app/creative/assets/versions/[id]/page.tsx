import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { VersionDetailView } from "@/components/creative/asset-views";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Creative Version" };

export default async function CreativeVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <VersionDetailView locale={locale} dir={dir} versionId={id} />
    </>
  );
}
