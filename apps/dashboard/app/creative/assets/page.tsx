import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { AssetsView } from "@/components/creative/assets-view";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Creative Assets" };

export default async function CreativeAssetsPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <AssetsView locale={locale} dir={dir} />
    </>
  );
}
