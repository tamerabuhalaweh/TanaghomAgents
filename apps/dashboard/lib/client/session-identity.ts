"use client";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import type { TenantNames } from "@/lib/tenant-name";

export interface SessionIdentity {
  user: { displayName: string; role: string };
  organization: (TenantNames & { name: string }) | null;
}

let cached: SessionIdentity | null = null;
let inFlight: Promise<SessionIdentity | null> | null = null;

async function fetchIdentity(): Promise<SessionIdentity | null> {
  const response = await authenticatedFetch("/api/auth/session", { cache: "no-store" });
  if (!response.ok) return null;
  return await response.json() as SessionIdentity;
}

/** One session request shared by the header and the profile menu. */
export function loadSessionIdentity(force = false): Promise<SessionIdentity | null> {
  if (!force && cached) return Promise.resolve(cached);
  if (!force && inFlight) return inFlight;
  inFlight = fetchIdentity()
    .then((value) => {
      cached = value;
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function invalidateSessionIdentity() {
  cached = null;
  inFlight = null;
}
