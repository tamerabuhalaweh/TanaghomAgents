import type { Metadata } from "next";

import { creativeLocale } from "@/lib/creative-locale";
import { JobsView } from "@/components/creative/jobs-view";

export const metadata: Metadata = { title: "Creative Jobs" };

export default async function CreativeJobsPage() {
  const { locale, dir } = await creativeLocale();
  return (
    <>
      <JobsView locale={locale} dir={dir} />
    </>
  );
}
