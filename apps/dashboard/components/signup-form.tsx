"use client";

import { ArrowRight, Eye, EyeOff, UserRoundPlus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { TurnstileWidget } from "@/components/turnstile-widget";
import type { AuthCopy } from "@/lib/i18n/auth";
import type { CreativeLocale } from "@/lib/i18n/creative";

const PASSWORD_ERRORS = new Set([
  "password_too_short",
  "password_too_simple",
  "password_too_common",
  "password_contains_email",
  "password_too_long",
]);

export function SignupForm({ copy, locale }: { copy: AuthCopy; locale: CreativeLocale }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const ar = locale === "ar";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    let response: Response;
    try {
      response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.get("full_name"),
          organization_name: form.get("organization_name"),
          email: form.get("email"),
          password: form.get("password"),
          turnstile_token: turnstileToken || undefined,
          locale,
        }),
      });
    } catch {
      setSubmitting(false);
      setError(copy.signupError);
      return;
    }

    if (response.ok) {
      window.location.assign("/");
      return;
    }

    const body = await response.json().catch(() => ({})) as { error?: string; retry_after?: number };
    const code = body.error ?? "";
    const retryAfter = response.status === 429
      ? Number(response.headers.get("retry-after")) || Number(body.retry_after) || 0
      : 0;
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    setSubmitting(false);
    if (response.status === 429 || code === "too_many_attempts") {
      setError(ar ? `محاولات تسجيل كثيرة. أعد المحاولة خلال ${minutes} ${minutes === 1 ? "دقيقة" : "دقائق"}.` : `Too many signup attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    } else if (code === "email_taken") setError(copy.emailTaken);
    else if (PASSWORD_ERRORS.has(code)) setError(copy.passwordTooShort);
    else if (code === "disposable_email_not_allowed") setError(ar ? "لا نقبل عناوين البريد المؤقتة. استخدم بريد عمل دائمًا." : "Temporary email addresses are not accepted. Use a permanent work email.");
    else if (code === "captcha_required" || code === "captcha_verification_failed") setError(ar ? "تعذر إكمال التحقق الأمني. أكمله مرة أخرى ثم أعد المحاولة." : "The security check could not be completed. Complete it again and retry.");
    else setError(copy.signupError);
  }

  return (
    <form className="login-form" method="post" onSubmit={submit} noValidate={false}>
      <div className="form-field">
        <label htmlFor="organization_name">{copy.organizationLabel}</label>
        <input
          id="organization_name"
          name="organization_name"
          type="text"
          autoComplete="organization"
          minLength={2}
          maxLength={120}
          placeholder={copy.organizationPlaceholder}
          required
        />
      </div>
      <div className="form-field">
        <label htmlFor="full_name">{copy.nameLabel}</label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          minLength={2}
          maxLength={120}
          placeholder={copy.namePlaceholder}
          required
        />
      </div>
      <div className="form-field">
        <label htmlFor="email">{copy.emailLabel}</label>
        <input id="email" name="email" type="email" autoComplete="email" maxLength={320} required />
      </div>
      <div className="form-field">
        <label htmlFor="password">{copy.passwordLabel}</label>
        <div className="password-input">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <button type="button" className="password-toggle" aria-controls="password" aria-pressed={showPassword} aria-label={showPassword ? (ar ? "إخفاء كلمة المرور" : "Hide password") : (ar ? "إظهار كلمة المرور" : "Show password")} onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            {showPassword ? (ar ? "إخفاء" : "Hide") : (ar ? "إظهار" : "Show")}
          </button>
        </div>
        <small>{copy.passwordHint}</small>
      </div>
      <TurnstileWidget locale={locale} onToken={setTurnstileToken} />
      <p className="login-error" role="alert" aria-live="polite">{error}</p>
      <button className="login-submit" type="submit" disabled={submitting}>
        <span>{submitting ? copy.submitting : copy.submit}</span>
        {submitting ? <UserRoundPlus size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </form>
  );
}
