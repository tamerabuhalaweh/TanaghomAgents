import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { VideoView } from "@/components/creative/video-view";

export const metadata: Metadata = { title: "New video" };

export default async function CreativeVideoPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <VideoView locale={locale} dir={dir} />
    </>
  );
}
