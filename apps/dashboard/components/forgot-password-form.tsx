"use client";

import { ArrowRight, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { AuthEmailCopy } from "@/lib/i18n/auth-email";

export function ForgotPasswordForm({ copy }: { copy: AuthEmailCopy }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setState("sending");
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.status === 429) {
        setError(copy.rateLimited);
        setState("idle");
        return;
      }
      if (!response.ok) {
        setError(copy.forgotError);
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError(copy.forgotError);
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="auth-state" role="status">
        <span className="auth-icon"><MailCheck size={24} /></span>
        <h2>{copy.resetSent}</h2>
        <a className="secondary-button" href="/login">{copy.backToSignIn}</a>
      </div>
    );
  }

  return (
    <form className="login-form" method="post" onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="forgot-email">{copy.emailLabel}</label>
        <input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <p className="login-error" role="alert" aria-live="polite">{error}</p>
      <button className="login-submit" type="submit" disabled={state === "sending"}>
        <span>{state === "sending" ? copy.sendingReset : copy.sendReset}</span>
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    </form>
  );
}
