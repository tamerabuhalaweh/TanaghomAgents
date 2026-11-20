import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { LocaleToggle } from "@/components/creative/locale-toggle";
import { LoginForm } from "@/components/login-form";
import { creativeLocale } from "@/lib/creative-locale";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; invite?: string }>;
}) {
  const params = await searchParams;
  const { locale, dir } = await creativeLocale();
  const ar = locale === "ar";

  return (
    <main className="login-page auth-page" dir={dir} lang={locale}>
      <section className="login-context" aria-labelledby="login-context-title">
        <Link className="brand login-brand" href="/" aria-label={ar ? "الصفحة الرئيسية لإعلاني" : "E3lani home"}>
          <BrandMark />
          <span>{ar ? "إعلاني" : "E3lani"}</span>
        </Link>
        <div className="login-promise">
          <p className="login-context-label">{ar ? "سجّل الدخول إلى إعلاني" : "Sign in to E3lani"}</p>
          <h1 id="login-context-title">{ar ? "كل ما ينشئه فريقك ويعتمده وينشره — في مكان واحد" : "Every decision stays visible."}</h1>
          <p>
            {ar
              ? "المسودات والموافقات والنشر تبقى في مساحة عملك، حتى بعد تحديث الصفحة"
              : "Review agent work, resolve blockers, and approve what moves forward from one accountable workspace."}
          </p>
        </div>
        <div className="login-trust-line">
          <ShieldCheck size={19} aria-hidden="true" />
          <span>
            {ar
              ? "بدون بطاقة ائتمانية."
              : "Human approval and immutable audit evidence are enforced in the database."}
          </span>
        </div>
      </section>

      <section className="login-access" aria-labelledby="login-title">
        <div className="login-panel">
          <div className="auth-locale-row"><LocaleToggle locale={locale} /></div>
          <Link className="login-mobile-brand" href="/" aria-label={ar ? "الصفحة الرئيسية لإعلاني" : "E3lani home"}>
            <BrandMark />
            <span>{ar ? "إعلاني" : "E3lani"}</span>
          </Link>
          <p className="login-access-label">{ar ? "مساحة عمل خاصة" : "Private workspace"}</p>
          <h2 id="login-title">{ar ? "أهلًا بعودتك" : "Welcome back"}</h2>
          <p className="login-intro">
            {ar
              ? "سجّل الدخول للمتابعة إلى مساحة عملك. أدخل بريدك الإلكتروني وكلمة المرور للمتابعة."
              : "Sign in with the owner or reviewer account connected to E3lani."}
          </p>
          {params.reset ? (
            <p className="login-notice" role="status">
              {ar ? "تم تحديث كلمة المرور. سجّل الدخول بكلمة المرور الجديدة." : "Your password was updated. Sign in with the new password."}
            </p>
          ) : null}
          {params.invite ? (
            <p className="login-notice" role="status">
              {ar ? "تم قبول الدعوة. سجّل الدخول إلى مساحة عملك." : "Invitation accepted. Sign in to enter your workspace."}
            </p>
          ) : null}
          <LoginForm locale={locale} />
          <p className="login-support">
            {ar ? <>جديد هنا؟ <Link href="/signup">أنشئ مساحة عمل</Link></> : <>New to E3lani? <a href="/signup">Create a workspace</a></>}
          </p>
          <p className="login-support">
            {ar ? "تتم إدارة الوصول بواسطة مسؤول إعلاني." : "Access is managed by your E3lani administrator."}
          </p>
          <nav className="auth-legal-links" aria-label={ar ? "روابط الأسعار والقانون" : "Legal and pricing links"}>
            <Link href="/pricing">{ar ? "الأسعار" : "Pricing"}</Link>
            <Link href="/privacy">{ar ? "سياسة الخصوصية" : "Privacy Policy"}</Link>
            <Link href="/terms">{ar ? "شروط الخدمة" : "Terms of Service"}</Link>
          </nav>
        </div>
      </section>
    </main>
  );
}
