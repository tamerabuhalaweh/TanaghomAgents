import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { DesignEditorView } from "@/components/creative/design-editor-view";

export const metadata: Metadata = { title: "Design Editor" };

export default async function CreativeDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <DesignEditorView locale={locale} dir={dir} templateId={id} />
    </>
  );
}
