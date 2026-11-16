import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { AssetsView } from "@/components/creative/assets-view";

export const metadata: Metadata = { title: "Creative Assets" };

export default async function CreativeAssetsPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <AssetsView locale={locale} dir={dir} />
    </>
  );
}
