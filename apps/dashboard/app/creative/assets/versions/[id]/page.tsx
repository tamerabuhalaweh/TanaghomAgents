import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { VersionDetailView } from "@/components/creative/asset-views";

export const metadata: Metadata = { title: "Creative Version" };

export default async function CreativeVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <VersionDetailView locale={locale} dir={dir} versionId={id} />
    </>
  );
}
