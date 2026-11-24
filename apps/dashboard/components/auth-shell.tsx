import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import type { CreativeLocale } from "@/lib/i18n/creative";
import { getMarketingOrigin, isSplitDomainMode } from "@/lib/public-urls";

export function AuthShell({
  locale,
  dir,
  eyebrow,
  title,
  lede,
  children,
}: {
  locale: CreativeLocale;
  dir: "ltr" | "rtl";
  eyebrow: string;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  const ar = locale === "ar";
  const marketingOrigin = isSplitDomainMode() ? getMarketingOrigin() : "";
  return (
    <main className="login-page" dir={dir} lang={locale}>
      <section className="login-context" aria-labelledby="auth-context-title">
        <a className="brand login-brand" href="/login" aria-label={ar ? "إعلاني" : "E3lani"}>
          <BrandMark />
          <span>{ar ? "إعلاني" : "E3lani"}</span>
        </a>
        <div className="login-promise">
          <p className="login-context-label">Agent operations, under human control</p>
          <h1 id="auth-context-title">Secure access, every time.</h1>
          <p>Recover access and confirm your address without exposing account details.</p>
        </div>
        <div className="login-trust-line">
          <ShieldCheck size={19} aria-hidden="true" />
          <span>Single-use links expire quickly, and password resets sign out every other session.</span>
        </div>
      </section>
      <section className="login-access" aria-labelledby="auth-title">
        <div className="login-panel">
          <div className="login-mobile-brand" aria-hidden="true">
            <BrandMark />
            <span>{ar ? "إعلاني" : "E3lani"}</span>
          </div>
          <p className="login-access-label">{eyebrow}</p>
          <h2 id="auth-title">{title}</h2>
          <p className="login-intro">{lede}</p>
          {children}
          <p className="login-support"><a href="/login">Back to sign in</a></p>
          <nav className="auth-legal-links" aria-label={ar ? "الروابط القانونية" : "Legal links"}>
            {marketingOrigin ? (
              <>
                <a href={`${marketingOrigin}/privacy`}>{ar ? "سياسة الخصوصية" : "Privacy Policy"}</a>
                <a href={`${marketingOrigin}/terms`}>{ar ? "شروط الخدمة" : "Terms of Service"}</a>
              </>
            ) : (
              <>
                <Link href="/privacy">{ar ? "سياسة الخصوصية" : "Privacy Policy"}</Link>
                <Link href="/terms">{ar ? "شروط الخدمة" : "Terms of Service"}</Link>
              </>
            )}
          </nav>
        </div>
      </section>
    </main>
  );
}
