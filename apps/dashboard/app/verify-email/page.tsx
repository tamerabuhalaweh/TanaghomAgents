import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";
import { VerifyEmailForm } from "@/components/verify-email-form";
import { creativeLocale } from "@/lib/creative-locale";
import { authEmailCopy } from "@/lib/i18n/auth-email";

export const metadata: Metadata = { title: "Verify email", robots: { index: false }, referrer: "no-referrer" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const { locale, dir } = await creativeLocale();
  const copy = authEmailCopy(locale);
  return (
    <AuthShell
      locale={locale}
      dir={dir}
      eyebrow={copy.verifyEyebrow}
      title={copy.verifyTitle}
      lede={copy.verifyLede}
    >
      <VerifyEmailForm token={token} copy={copy} />
    </AuthShell>
  );
}
