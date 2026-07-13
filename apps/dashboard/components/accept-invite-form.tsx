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

export function AcceptInviteForm() {
  const [session, setSession] = useState<InviteSession | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setSession(inviteSession()); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    if (password.length < 12) return setError("Use at least 12 characters.");
    if (password !== confirmation) return setError("The passwords do not match.");
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password, refresh_token: session.refreshToken }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error);
      }
      window.location.assign("/");
    } catch {
      setError("This invitation could not be completed. Ask your Tanaghom admin to send a new invitation.");
      setSubmitting(false);
    }
  }

  if (session === undefined) return <div className="invite-state">Checking invitation…</div>;
  if (!session) {
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
        <form className="login-form" onSubmit={submit}>
          <div className="form-field"><label htmlFor="invite-password">Password</label><input id="invite-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /><span className="field-help">At least 12 characters. Do not reuse your server password.</span></div>
          <div className="form-field"><label htmlFor="invite-confirmation">Confirm password</label><input id="invite-confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></div>
          <p className="login-error" role="alert">{error}</p>
          <button className="login-submit" type="submit" disabled={submitting}><span>{submitting ? "Activating…" : "Activate account"}</span><ArrowRight size={18} /></button>
        </form>
      </section>
    </main>
  );
}
