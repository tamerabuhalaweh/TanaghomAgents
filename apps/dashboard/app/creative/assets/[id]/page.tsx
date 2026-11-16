import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { AssetDetailView } from "@/components/creative/asset-views";

export const metadata: Metadata = { title: "Creative Asset" };

export default async function CreativeAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <AssetDetailView locale={locale} dir={dir} assetId={id} />
    </>
  );
}
