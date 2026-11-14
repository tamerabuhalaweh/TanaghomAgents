"use client";

import { ArrowRight, MailCheck, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import type { AuthEmailCopy } from "@/lib/i18n/auth-email";

type VerifyState = "idle" | "verifying" | "verified" | "error";
type SessionState = "checking" | "signed-out" | "unverified" | "verified";

export function VerifyEmailForm({ token, copy }: { token: string; copy: AuthEmailCopy }) {
  const [state, setState] = useState<VerifyState>(token ? "verifying" : "idle");
  const [session, setSession] = useState<SessionState>("checking");
  const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");
  const [message, setMessage] = useState("");
  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) return setSession("signed-out");
        const body = await response.json().catch(() => ({})) as { user?: { email_verified?: boolean } };
        setSession(body.user?.email_verified ? "verified" : "unverified");
      })
      .catch(() => { if (!cancelled) setSession("signed-out"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // React strict mode replays effects in development; consume the one-time
    // token exactly once.
    if (!token || started.current) return;
    started.current = true;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (response.ok) {
          setState("verified");
          return;
        }
        const body = await response.json().catch(() => ({})) as { error?: string };
        setMessage(response.status === 429 ? copy.rateLimited : body.error ? copy.verifyError : copy.verifyError);
        setState("error");
      })
      .catch(() => {
        setMessage(copy.verifyError);
        setState("error");
      });
  }, [copy, token]);

  async function resendVerification() {
    setResend("sending");
    setMessage("");
    try {
      const response = await authenticatedFetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 401) {
        setSession("signed-out");
        setMessage(copy.signedOutVerify);
        setResend("idle");
        return;
      }
      if (response.status === 429) {
        setMessage(copy.rateLimited);
        setResend("idle");
        return;
      }
      const body = await response.json().catch(() => ({})) as { already_verified?: boolean; error?: string };
      if (!response.ok) {
        setMessage(copy.verifyError);
        setResend("idle");
        return;
      }
      if (body.already_verified) {
        setMessage(copy.alreadyVerified);
        setSession("verified");
      } else {
        setMessage(copy.verificationSent);
      }
      setResend("sent");
    } catch {
      setMessage(copy.verifyError);
      setResend("idle");
    }
  }

  if (state === "verifying") {
    return <div className="auth-state" role="status"><span className="auth-icon"><RefreshCw className="spin" size={24} /></span><h2>{copy.verifying}</h2></div>;
  }

  if (state === "verified") {
    return (
      <div className="auth-state" role="status">
        <span className="auth-icon"><MailCheck size={24} /></span>
        <h2>{copy.verified}</h2>
        <p>{copy.verifiedLede}</p>
        <a className="secondary-button" href="/login">{copy.backToSignIn}</a>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="auth-state auth-state-error" role="alert">
        <span className="auth-icon"><TriangleAlert size={24} /></span>
        <h2>{message || copy.verifyError}</h2>
        <a className="secondary-button" href="/login">{copy.backToSignIn}</a>
      </div>
    );
  }

  return (
    <div className="auth-state">
      <span className="auth-icon"><MailCheck size={24} /></span>
      <h2>{copy.verifyTitle}</h2>
      <p>{copy.verifyLede}</p>
      {message ? <p className="auth-message" role="status">{message}</p> : null}
      {session === "unverified" ? (
        <button className="login-submit auth-action" type="button" onClick={() => void resendVerification()} disabled={resend === "sending"}>
          <span>{resend === "sending" ? copy.resendingVerification : copy.resendVerification}</span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      ) : null}
      {session === "verified" ? <p>{copy.alreadyVerified}</p> : null}
      {session === "signed-out" ? <a className="secondary-button" href="/login">{copy.backToSignIn}</a> : null}
    </div>
  );
}
