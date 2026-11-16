"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";

import type { CreativeLocale } from "@/lib/i18n/creative";

export function LoginForm({ locale }: { locale: CreativeLocale }) {
  const ar = locale === "ar";
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });

    if (response.ok) {
      const body = await response.json().catch(() => ({})) as { must_change_password?: boolean };
      window.location.assign(body.must_change_password ? "/settings/security" : "/");
      return;
    }

    const retryAfter = response.status === 429
      ? Number(response.headers.get("retry-after")) || 0
      : 0;
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    setError(response.status === 401
      ? (ar ? "البريد الإلكتروني أو كلمة المرور غير مطابقين لحساب تناغم نشط." : "That email and password do not match an active Tanaghom account.")
      : response.status === 429
        ? (ar ? `محاولات دخول كثيرة. أعد المحاولة خلال ${minutes} ${minutes === 1 ? "دقيقة" : "دقائق"}.` : `Too many sign-in attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`)
        : (ar ? "تعذّر على تناغم تسجيل دخولك. أعد المحاولة بعد قليل." : "Tanaghom could not sign you in. Please try again in a moment."));
    setSubmitting(false);
  }

  return (
    <form className="login-form" method="post" onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="email">{ar ? "البريد الإلكتروني" : "Email address"}</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="form-field">
        <div className="field-label-row">
          <label htmlFor="password">{ar ? "كلمة المرور" : "Password"}</label>
          <a className="field-link" href="/forgot-password">{ar ? "نسيت كلمة المرور؟" : "Forgot password?"}</a>
        </div>
        <div className="password-input">
          <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required />
          <button type="button" className="password-toggle" aria-controls="password" aria-pressed={showPassword} aria-label={showPassword ? (ar ? "إخفاء كلمة المرور" : "Hide password") : (ar ? "إظهار كلمة المرور" : "Show password")} onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            {showPassword ? (ar ? "إخفاء" : "Hide") : (ar ? "إظهار" : "Show")}
          </button>
        </div>
      </div>
      <p className="login-error" role="alert" aria-live="polite">{error}</p>
      <button className="login-submit" type="submit" disabled={submitting}>
        <span>{submitting ? (ar ? "جارٍ تسجيل الدخول…" : "Signing in…") : (ar ? "تسجيل الدخول" : "Enter workspace")}</span>
        {submitting ? <LockKeyhole size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </form>
  );
}
