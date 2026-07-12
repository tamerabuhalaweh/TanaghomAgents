let refreshInFlight: Promise<Response> | null = null;

function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST", cache: "no-store" })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  const retry = request.clone();
  const response = await fetch(request);
  if (response.status !== 401) return response;

  const refresh = await refreshSession();
  if (refresh.ok) return fetch(retry);
  if (refresh.status === 401 && typeof window !== "undefined") {
    window.location.assign("/login");
  }
  return response;
}
