"use client";

import { ArrowRight, KeyRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import type { AuthEmailCopy } from "@/lib/i18n/auth-email";

const POLICY_ERRORS = new Set([
  "password_required",
  "password_too_short",
  "password_too_long",
  "password_too_simple",
  "password_too_common",
  "password_contains_email",
]);

export function ResetPasswordForm({ token, copy }: { token: string; copy: AuthEmailCopy }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (state !== "saved") return;
    const timer = window.setTimeout(() => window.location.assign("/login?reset=1"), 1200);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError(copy.passwordMismatch);
      return;
    }
    setState("saving");
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (response.status === 429) {
        setError(copy.rateLimited);
        setState("idle");
        return;
      }
      if (response.status === 400) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setError(body.error && POLICY_ERRORS.has(body.error)
          ? copy.passwordTooWeak
          : copy.invalidToken);
        setState("idle");
        return;
      }
      if (!response.ok) {
        setError(copy.resetError);
        setState("idle");
        return;
      }
      setState("saved");
    } catch {
      setError(copy.resetError);
      setState("idle");
    }
  }

  if (!token) {
    return (
      <div className="auth-state auth-state-error" role="alert">
        <span className="auth-icon"><KeyRound size={24} /></span>
        <h2>{copy.invalidToken}</h2>
        <a className="secondary-button" href="/forgot-password">{copy.sendReset}</a>
      </div>
    );
  }

  if (state === "saved") {
    return (
      <div className="auth-state" role="status">
        <span className="auth-icon"><KeyRound size={24} /></span>
        <h2>{copy.resetSuccess}</h2>
        <a className="secondary-button" href="/login?reset=1">{copy.backToSignIn}</a>
      </div>
    );
  }

  return (
    <form className="login-form" method="post" onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="reset-password">{copy.newPassword}</label>
        <input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <span className="field-help">{copy.passwordHint}</span>
      </div>
      <div className="form-field">
        <label htmlFor="reset-confirmation">{copy.confirmPassword}</label>
        <input
          id="reset-confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
        />
      </div>
      <p className="login-error" role="alert" aria-live="polite">{error}</p>
      <button className="login-submit" type="submit" disabled={state === "saving"}>
        <span>{state === "saving" ? copy.choosingPassword : copy.choosePassword}</span>
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    </form>
  );
}
