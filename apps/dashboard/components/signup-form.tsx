"use client";

import { ArrowRight, UserRoundPlus } from "lucide-react";
import { useState, type FormEvent } from "react";

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

    const body = await response.json().catch(() => ({})) as { error?: string };
    const code = body.error ?? "";
    setSubmitting(false);
    if (code === "email_taken") setError(copy.emailTaken);
    else if (PASSWORD_ERRORS.has(code)) setError(copy.passwordTooShort);
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
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
        <small>{copy.passwordHint}</small>
      </div>
      <p className="login-error" role="alert" aria-live="polite">{error}</p>
      <button className="login-submit" type="submit" disabled={submitting}>
        <span>{submitting ? copy.submitting : copy.submit}</span>
        {submitting ? <UserRoundPlus size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </form>
  );
}
