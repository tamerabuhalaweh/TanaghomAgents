"use client";

import { ArrowRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

interface InviteSession {
  accessToken: string;
  refreshToken: string;
}

function inviteSession(): InviteSession | null {
  const values = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = values.get("access_token");
  const refreshToken = values.get("refresh_token");
  const type = values.get("type");
  if (!accessToken || !refreshToken || type !== "invite") return null;
  window.history.replaceState({}, "", window.location.pathname);
  return { accessToken, refreshToken };
}

export function AcceptInviteForm({ token = "" }: { token?: string }) {
  const tokenMode = Boolean(token);
  const [session, setSession] = useState<InviteSession | null | undefined>(tokenMode ? null : undefined);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (!tokenMode) setSession(inviteSession()); }, [tokenMode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!tokenMode && !session) return;
    if (password.length < 10) return setError("Use at least 10 characters with upper and lower case letters and a number.");
    if (password !== confirmation) return setError("The passwords do not match.");
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(!tokenMode && session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        },
        body: JSON.stringify(tokenMode
          ? { token, password, display_name: displayName.trim() || undefined }
          : { password, refresh_token: session?.refreshToken }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        if (body.error === "invalid_or_expired_token" || body.error === "invite_session_invalid") {
          throw new Error("expired");
        }
        const policyError = body.error?.startsWith("password_");
        throw new Error(policyError ? "password" : "failed");
      }
      window.location.assign(tokenMode ? "/login?invite=1" : "/");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(code === "expired"
        ? "This invitation is invalid or has expired. Ask your Tanaghom admin to send a new invitation."
        : code === "password"
          ? "Use at least 10 characters with upper and lower case letters and a number."
          : "This invitation could not be completed. Ask your Tanaghom admin to send a new invitation.");
      setSubmitting(false);
    }
  }

  if (!tokenMode && session === undefined) return <div className="invite-state">Checking invitation…</div>;
  if (!tokenMode && !session) {
    return (
      <div className="invite-state invite-state-error">
        <TriangleAlert size={24} />
        <h1>Invitation unavailable</h1>
        <p>This link is invalid or expired. Ask your Tanaghom admin to send a new invitation.</p>
        <a className="secondary-button" href="/login">Return to sign in</a>
      </div>
    );
  }

  return (
    <main className="invite-page">
      <section className="invite-panel" aria-labelledby="invite-title">
        <span className="invite-icon"><ShieldCheck size={24} /></span>
        <p className="login-access-label">INVITED ACCESS</p>
        <h1 id="invite-title">Join Tanaghom</h1>
        <p className="login-intro">Set a private password to activate the role your admin assigned.</p>
        <form className="login-form" method="post" onSubmit={submit}>
          {tokenMode ? <div className="form-field"><label htmlFor="invite-name">Display name</label><input id="invite-name" type="text" autoComplete="name" minLength={2} maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Keep the name your admin used" /><span className="field-help">Leave blank to keep the invited name.</span></div> : null}
          <div className="form-field"><label htmlFor="invite-password">Password</label><input id="invite-password" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /><span className="field-help">At least 10 characters with upper and lower case letters and a number.</span></div>
          <div className="form-field"><label htmlFor="invite-confirmation">Confirm password</label><input id="invite-confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></div>
          <p className="login-error" role="alert">{error}</p>
          <button className="login-submit" type="submit" disabled={submitting}><span>{submitting ? "Activating…" : "Activate account"}</span><ArrowRight size={18} /></button>
        </form>
      </section>
    </main>
  );
}
