import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { GenerateView } from "@/components/creative/generate-view";

export const metadata: Metadata = { title: "New Image" };

export default async function CreativeGeneratePage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <GenerateView locale={locale} dir={dir} />
    </>
  );
}
