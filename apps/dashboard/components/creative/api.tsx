"use client";

import { useCallback, useEffect, useState } from "react";

import { t, type CreativeLocale } from "@/lib/i18n/creative";

export class CreativeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new CreativeApiError(response.status, typeof body.error === "string" ? body.error : "request_failed");
  return body as T;
}

export function idempotencyKey(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${prefix}-${random}`.slice(0, 128);
}

export type SessionRole = "owner" | "reviewer" | "operator" | "viewer" | null;

export function useSessionRole() {
  const [role, setRole] = useState<SessionRole>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ user: { role: SessionRole } }>("/api/auth/session")
      .then((body) => { if (!cancelled) setRole(body.user?.role ?? null); })
      .catch(() => { if (!cancelled) setRole(null); });
    return () => { cancelled = true; };
  }, []);
  return role;
}

export function useCreativeFetch<T>(locale: CreativeLocale, path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (requestError) {
      setError(requestError instanceof CreativeApiError ? requestError.code : "request_failed");
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

export function Loading({ locale }: { locale: CreativeLocale }) {
  return <p>{t(locale, "common.loading")}</p>;
}

export function LoadError({ locale, error, onRetry }: { locale: CreativeLocale; error: string; onRetry: () => void }) {
  return (
    <div className="creative-notice creative-error" role="alert">
      <p>{t(locale, "common.error")} ({error})</p>
      <button type="button" className="creative-button creative-button-secondary" onClick={onRetry}>
        {t(locale, "common.retry")}
      </button>
    </div>
  );
}
