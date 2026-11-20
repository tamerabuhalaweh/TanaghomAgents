import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { DesignsView } from "@/components/creative/designs-view";

export const metadata: Metadata = { title: "Design Studio" };

export default async function CreativeDesignsPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <DesignsView locale={locale} dir={dir} />
    </>
  );
}
