import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { JobDetailView } from "@/components/creative/job-detail-view";
import { LocaleToggle } from "@/components/creative/locale-toggle";

export const metadata: Metadata = { title: "Creative Job" };

export default async function CreativeJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <LocaleToggle locale={locale} />
      <JobDetailView locale={locale} dir={dir} jobId={id} />
    </>
  );
}
