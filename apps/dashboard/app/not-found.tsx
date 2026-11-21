import Link from "next/link";

import { creativeLocale } from "@/lib/creative-locale";

export default async function NotFound() {
  let locale: "en" | "ar" = "en";
  let dir: "ltr" | "rtl" = "ltr";
  try {
    ({ locale, dir } = await creativeLocale());
  } catch {
    // A missing cookie store must never break the error page.
  }
  const ar = locale === "ar";
  return (
    <main className="not-found-page" dir={dir} lang={locale}>
      <p className="eyebrow">{ar ? "خطأ 404" : "Error 404"}</p>
      <h1>{ar ? "هذه الصفحة غير موجودة" : "This page could not be found"}</h1>
      <p>{ar ? "قد يكون الرابط قديمًا أو أن الصفحة نُقلت. تعود بقية مساحة العمل كما هي." : "The link may be old, or the page may have moved. The rest of your workspace is unchanged."}</p>
      <div className="not-found-actions">
        <Link className="primary-button" href="/">{ar ? "العودة إلى لوحة التحكم" : "Back to overview"}</Link>
        <Link className="secondary-button" href="/workspace">{ar ? "فتح مساحة العمل" : "Open the workspace"}</Link>
      </div>
    </main>
  );
}
