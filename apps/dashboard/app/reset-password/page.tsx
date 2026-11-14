import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { creativeLocale } from "@/lib/creative-locale";
import { authEmailCopy } from "@/lib/i18n/auth-email";

export const metadata: Metadata = { title: "Reset password", robots: { index: false }, referrer: "no-referrer" };

export default async function ResetPasswordPage({
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
      eyebrow={copy.resetEyebrow}
      title={copy.resetTitle}
      lede={copy.resetLede}
    >
      <ResetPasswordForm token={token} copy={copy} />
    </AuthShell>
  );
}
