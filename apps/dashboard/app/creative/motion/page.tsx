import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { MotionsView } from "@/components/creative/motions-view";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Motion" };

export default async function CreativeMotionPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <MotionsView locale={locale} dir={dir} />
    </>
  );
}
