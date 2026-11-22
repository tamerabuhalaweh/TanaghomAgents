import { buildLoginRedirectUrl } from "@/lib/safe-next-path";

const KEEPALIVE_INTERVAL_MS = 60_000;
const REFRESH_MIN_GAP_MS = 10 * 60_000;
const ACTIVITY_WINDOW_MS = 25 * 60_000;

let refreshInFlight: Promise<Response> | null = null;
let lastRefreshAt = 0;
let lastActivityAt = typeof Date !== "undefined" ? Date.now() : 0;

export function markSessionActive() {
  lastActivityAt = Date.now();
}

export function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST", cache: "no-store" })
      .then((response) => {
        if (response.ok) lastRefreshAt = Date.now();
        return response;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export function startSessionKeepAlive() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const now = Date.now();
  if (!lastRefreshAt) lastRefreshAt = now;
  lastActivityAt = now;

  const onActivity = () => {
    markSessionActive();
  };
  const maybeRefresh = () => {
    if (document.hidden) return;
    const current = Date.now();
    if (current - lastActivityAt > ACTIVITY_WINDOW_MS) return;
    if (current - lastRefreshAt < REFRESH_MIN_GAP_MS) return;
    void refreshSession();
  };

  for (const eventName of ["pointerdown", "keydown", "focus"]) {
    window.addEventListener(eventName, onActivity, { passive: true });
  }
  document.addEventListener("visibilitychange", maybeRefresh);
  const timer = window.setInterval(maybeRefresh, KEEPALIVE_INTERVAL_MS);

  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", maybeRefresh);
    for (const eventName of ["pointerdown", "keydown", "focus"]) {
      window.removeEventListener(eventName, onActivity);
    }
  };
}

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  markSessionActive();
  const request = new Request(input, init);
  const retry = request.clone();
  const response = await fetch(request);
  if (response.status !== 401) return response;

  const refresh = await refreshSession();
  if (refresh.ok) return fetch(retry);
  if (refresh.status === 401 && typeof window !== "undefined") {
    window.location.assign(buildLoginRedirectUrl(window.location.pathname, window.location.search));
  }
  return response;
}
