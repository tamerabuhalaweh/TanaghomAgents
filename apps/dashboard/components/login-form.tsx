"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";

export function LoginForm() {
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
      ? "That email and password do not match an active Tanaghom account."
      : response.status === 429
        ? `Too many sign-in attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`
        : "Tanaghom could not sign you in. Please try again in a moment.");
    setSubmitting(false);
  }

  return (
    <form className="login-form" method="post" onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="form-field">
        <div className="field-label-row">
          <label htmlFor="password">Password</label>
          <a className="field-link" href="/forgot-password">Forgot password?</a>
        </div>
        <div className="password-input">
          <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required />
          <button type="button" className="password-toggle" aria-controls="password" aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      <p className="login-error" role="alert" aria-live="polite">{error}</p>
      <button className="login-submit" type="submit" disabled={submitting}>
        <span>{submitting ? "Signing in…" : "Enter workspace"}</span>
        {submitting ? <LockKeyhole size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </form>
  );
}
