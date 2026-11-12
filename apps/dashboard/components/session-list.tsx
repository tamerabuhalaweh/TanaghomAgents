"use client";

import { Laptop, LogOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import type { AuthCopy } from "@/lib/i18n/auth";

interface Session {
  id: string;
  organization_name: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
  current: boolean;
}

export function SessionList({ copy }: { copy: AuthCopy }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await authenticatedFetch("/api/auth/sessions", { cache: "no-store" });
      if (!response.ok) {
        setError(copy.sessionsError);
        return;
      }
      const body = await response.json() as { sessions?: Session[] };
      setSessions(body.sessions ?? []);
    } catch {
      setError(copy.sessionsError);
    }
  }, [copy.sessionsError]);

  useEffect(() => { void load(); }, [load]);

  async function revoke(id: string) {
    setRevoking(id);
    setNotice("");
    try {
      const response = await authenticatedFetch(`/api/auth/sessions?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(copy.sessionsError);
        return;
      }
      const body = await response.json().catch(() => ({})) as { reauthenticate?: boolean };
      if (body.reauthenticate) {
        window.location.assign("/login");
        return;
      }
      setNotice(copy.sessionsRevoked);
      await load();
    } catch {
      setError(copy.sessionsError);
    } finally {
      setRevoking("");
    }
  }

  return (
    <section className="panel" aria-labelledby="sessions-title">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Account security</p>
          <h2 id="sessions-title">{copy.sessionsTitle}</h2>
          <p>{copy.sessionsLede}</p>
        </div>
      </header>

      {error ? <p className="login-error" role="alert">{error}</p> : null}
      {notice ? <p role="status" aria-live="polite">{notice}</p> : null}

      {sessions === null ? (
        <p>{copy.sessionsError ? "…" : ""}</p>
      ) : sessions.length === 0 ? (
        <p>{copy.sessionsEmpty}</p>
      ) : (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id} className="session-list-item">
              <div>
                <p>
                  <Laptop size={16} aria-hidden="true" /> {session.organization_name}
                  {session.current ? <strong> · {copy.sessionsCurrent}</strong> : null}
                </p>
                <small>
                  {copy.sessionsLastSeen}: {new Date(session.last_seen_at).toLocaleString()}
                  {session.user_agent ? ` · ${session.user_agent.slice(0, 80)}` : ""}
                </small>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={revoking === session.id}
                onClick={() => void revoke(session.id)}
              >
                <LogOut size={15} aria-hidden="true" />
                {revoking === session.id ? copy.sessionsRevoking : copy.sessionsRevoke}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
