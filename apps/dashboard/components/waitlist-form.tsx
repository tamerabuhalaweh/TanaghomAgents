"use client";

import { Check, LoaderCircle, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";

import { TurnstileWidget } from "@/components/turnstile-widget";

const copy = {
  en: {
    title: "Join the priority waitlist",
    lede: "The current cohort is full. Leave your work email and we will hold your place in line.",
    email: "Work email",
    company: "Company",
    submit: "Join waitlist",
    joining: "Joining…",
    joined: "You are in the priority queue.",
    position: "Queue position",
    error: "The waitlist could not be joined. Try again shortly.",
    disposable: "Temporary email addresses are not accepted. Use a permanent work email.",
    captcha: "The security check could not be completed. Complete it again and retry.",
    privacyPrefix: "We use your email only to notify you when a launch spot opens.",
    privacyLink: "Privacy Policy",
  },
  ar: {
    title: "انضم إلى قائمة الأولوية",
    lede: "اكتمل عدد أماكن الدفعة الحالية. أدخل بريد العمل لنحتفظ لك بموقعك في قائمة الانتظار.",
    email: "بريد العمل",
    company: "الشركة",
    submit: "انضم إلى قائمة الانتظار",
    joining: "جارٍ الانضمام…",
    joined: "أنت الآن في قائمة الأولوية.",
    position: "ترتيبك",
    error: "تعذّر الانضمام إلى قائمة الانتظار. حاول مجددًا بعد قليل.",
    disposable: "لا نقبل عناوين البريد المؤقتة. استخدم بريد عمل دائمًا.",
    captcha: "تعذر إكمال التحقق الأمني. أكمله مرة أخرى ثم أعد المحاولة.",
    privacyPrefix: "نستخدم بريدك الإلكتروني فقط لإبلاغك عند توفر مكان في الدفعة.",
    privacyLink: "سياسة الخصوصية",
  },
} as const;

export function WaitlistForm({ locale }: { locale: "en" | "ar" }) {
  const text = copy[locale];
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company_name: company, turnstile_token: turnstileToken || undefined, locale }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as { queue_position?: number; error?: string };
      if (!response.ok || !payload.queue_position) {
        if (payload.error === "disposable_email_not_allowed") setError(text.disposable);
        else if (payload.error === "captcha_verification_failed") setError(text.captcha);
        else setError(text.error);
        return;
      }
      setPosition(payload.queue_position);
    } catch {
      setError(text.error);
    } finally {
      setBusy(false);
    }
  }

  if (position) {
    return (
      <section className="waitlist-form waitlist-success" aria-live="polite">
        <Check size={20} aria-hidden="true" />
        <div><strong>{text.joined}</strong><p>{text.position}: <bdi>#{position}</bdi></p></div>
      </section>
    );
  }

  return (
    <form className="waitlist-form" onSubmit={submit}>
      <div className="waitlist-form-heading">
        <Mail size={20} aria-hidden="true" />
        <div><strong>{text.title}</strong><p>{text.lede}</p></div>
      </div>
      <div className="waitlist-fields">
        <label><span>{text.email}</span><input type="email" name="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label><span>{text.company}</span><input type="text" name="company" autoComplete="organization" maxLength={160} value={company} onChange={(event) => setCompany(event.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Mail size={16} />}
          {busy ? text.joining : text.submit}
        </button>
      </div>
      <TurnstileWidget locale={locale} onToken={setTurnstileToken} />
      <p className="waitlist-privacy">{text.privacyPrefix}{" "}<a href="/privacy">{text.privacyLink}</a>.</p>
      {error ? <p className="waitlist-error" role="alert">{error}</p> : null}
    </form>
  );
}
