import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { creativeLocale } from "@/lib/creative-locale";
import { authEmailCopy } from "@/lib/i18n/auth-email";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default async function ForgotPasswordPage() {
  const { locale, dir } = await creativeLocale();
  const copy = authEmailCopy(locale);
  return (
    <AuthShell
      locale={locale}
      dir={dir}
      eyebrow={copy.forgotEyebrow}
      title={copy.forgotTitle}
      lede={copy.forgotLede}
    >
      <ForgotPasswordForm copy={copy} />
    </AuthShell>
  );
}
