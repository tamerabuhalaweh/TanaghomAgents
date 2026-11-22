import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { LocaleToggle } from "@/components/creative/locale-toggle";
import { SignupForm } from "@/components/signup-form";
import { creativeLocale } from "@/lib/creative-locale";
import { authCopy } from "@/lib/i18n/auth";
import { getMarketingOrigin, isSplitDomainMode } from "@/lib/public-urls";

export const metadata: Metadata = { title: "Create workspace", robots: { index: false, follow: false } };

export default async function SignupPage() {
  const { locale, dir } = await creativeLocale();
  const copy = authCopy(locale);
  const ar = locale === "ar";
  const marketingOrigin = isSplitDomainMode() ? getMarketingOrigin() : "";
  const benefits = ar
    ? ["هويات بصرية وقوالب", "المسودات والموافقات والنشر", "الحملات والعملاء المحتملون", "معرفة يثق بها فريقك"]
    : ["Visual identities and templates", "Drafts, approvals, and publishing", "Campaigns and leads", "Knowledge your team can trust"];

  return (
    <main className="login-page auth-page signup-page" dir={dir} lang={locale}>
      <section className="login-context" aria-labelledby="signup-context-title">
        {marketingOrigin ? (
          <a className="brand login-brand" href={`${marketingOrigin}/`} aria-label={ar ? "الصفحة الرئيسية لإعلاني" : "E3lani home"}>
            <BrandMark />
            <span>{ar ? "إعلاني" : "E3lani"}</span>
          </a>
        ) : (
          <Link className="brand login-brand" href="/" aria-label={ar ? "الصفحة الرئيسية لإعلاني" : "E3lani home"}>
            <BrandMark />
            <span>{ar ? "إعلاني" : "E3lani"}</span>
          </Link>
        )}
        <div className="login-promise">
          <p className="login-context-label">{ar ? "إعلاني لمساحات العمل" : "E3lani for teams"}</p>
          <h1 id="signup-context-title">{ar ? "أنشئ مساحة عملك الأولى" : "Create your first workspace."}</h1>
          <p>{ar ? "بيت واحد واضح لمحتوى فريقك وحملاته وعملائه." : "One clear home for your team's content, campaigns, and customers."}</p>
          <ul className="signup-benefits">
            {benefits.map((benefit) => <li key={benefit}><ShieldCheck size={17} aria-hidden="true" />{benefit}</li>)}
          </ul>
        </div>
        <div className="login-trust-line">
          <ShieldCheck size={19} aria-hidden="true" />
          <span>
            {ar
              ? "عزل بيانات المؤسسات والاعتماد البشري مفروضان في قاعدة البيانات. تتم عملية الدفع بالكامل عبر Stripe بأمان."
              : "Tenant isolation and human approval are enforced in the database. Checkout is handled securely by Stripe."}
          </span>
        </div>
      </section>

      <section className="login-access" aria-labelledby="signup-title">
        <div className="login-panel">
          <div className="auth-locale-row"><LocaleToggle locale={locale} /></div>
          {marketingOrigin ? (
            <a className="login-mobile-brand" href={`${marketingOrigin}/`} aria-label={ar ? "الصفحة الرئيسية لإعلاني" : "E3lani home"}>
              <BrandMark />
              <span>{ar ? "إعلاني" : "E3lani"}</span>
            </a>
          ) : (
            <Link className="login-mobile-brand" href="/" aria-label={ar ? "الصفحة الرئيسية لإعلاني" : "E3lani home"}>
              <BrandMark />
              <span>{ar ? "إعلاني" : "E3lani"}</span>
            </Link>
          )}
          <p className="login-access-label">{copy.signupEyebrow}</p>
          <h2 id="signup-title">{copy.signupTitle}</h2>
          <p className="login-intro">{copy.signupLede}</p>
          <SignupForm copy={copy} locale={locale} />
          <p className="login-support">
            {copy.haveAccount} <Link href="/login">{copy.signIn}</Link>
          </p>
          <nav className="auth-legal-links" aria-label={ar ? "روابط الأسعار والسياسات القانونية" : "Legal and pricing links"}>
            {marketingOrigin ? (
              <>
                <a href={`${marketingOrigin}/pricing`}>{ar ? "الأسعار" : "Pricing"}</a>
                <a href={`${marketingOrigin}/privacy`}>{ar ? "سياسة الخصوصية" : "Privacy Policy"}</a>
                <a href={`${marketingOrigin}/terms`}>{ar ? "شروط الاستخدام" : "Terms of Service"}</a>
              </>
            ) : (
              <>
                <Link href="/pricing">{ar ? "الأسعار" : "Pricing"}</Link>
                <Link href="/privacy">{ar ? "سياسة الخصوصية" : "Privacy Policy"}</Link>
                <Link href="/terms">{ar ? "شروط الاستخدام" : "Terms of Service"}</Link>
              </>
            )}
          </nav>
        </div>
      </section>
    </main>
  );
}
