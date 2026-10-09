import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { VideoView } from "@/components/creative/video-view";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "New video" };

export default async function CreativeVideoPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <VideoView locale={locale} dir={dir} />
    </>
  );
}
