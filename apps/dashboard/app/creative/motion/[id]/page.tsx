import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { MotionEditorView } from "@/components/creative/motion-editor-view";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Motion detail" };

export default async function CreativeMotionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <MotionEditorView locale={locale} dir={dir} templateId={id} />
    </>
  );
}
