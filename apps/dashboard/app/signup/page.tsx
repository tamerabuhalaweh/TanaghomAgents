import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { SignupForm } from "@/components/signup-form";
import { creativeLocale } from "@/lib/creative-locale";
import { authCopy } from "@/lib/i18n/auth";

export const metadata: Metadata = { title: "Create workspace" };

export default async function SignupPage() {
  const { locale, dir } = await creativeLocale();
  const copy = authCopy(locale);

  return (
    <main className="login-page" dir={dir} lang={locale}>
      <section className="login-context" aria-labelledby="signup-context-title">
        <a className="brand login-brand" href="/login" aria-label="Tanaghom">
          <BrandMark />
          <span>Tanaghom</span>
        </a>
        <div className="login-promise">
          <p className="login-context-label">Agent operations, under human control</p>
          <h1 id="signup-context-title">One workspace per business.</h1>
          <p>
            Plan, review, and approve AI-assisted content in Arabic and English. Every
            organization sees only its own data.
          </p>
        </div>
        <div className="login-trust-line">
          <ShieldCheck size={19} aria-hidden="true" />
          <span>Tenant isolation and human approval are enforced in the database.</span>
        </div>
      </section>

      <section className="login-access" aria-labelledby="signup-title">
        <div className="login-panel">
          <div className="login-mobile-brand" aria-hidden="true">
            <BrandMark />
            <span>Tanaghom</span>
          </div>
          <p className="login-access-label">{copy.signupEyebrow}</p>
          <h2 id="signup-title">{copy.signupTitle}</h2>
          <p className="login-intro">{copy.signupLede}</p>
          <SignupForm copy={copy} locale={locale} />
          <p className="login-support">
            {copy.haveAccount} <Link href="/login">{copy.signIn}</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
