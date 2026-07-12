"use client";

import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";

interface SessionUser {
  displayName: string;
  role: string;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function SessionProfile() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void authenticatedFetch("/api/auth/session", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) return;
      if (!response.ok) return;
      const payload = await response.json() as { user: SessionUser };
      setUser(payload.user);
    });
  }, []);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return (
    <button className="profile-switcher" type="button" onClick={() => void signOut()} disabled={signingOut} aria-label={user ? `Sign out ${user.displayName}` : "Sign out"}>
      <span className="avatar">{user ? initials(user.displayName) : "—"}</span>
      <span className="profile-copy"><strong>{user?.displayName || "Loading profile"}</strong><small>{user ? user.role : "Authenticated session"}</small></span>
      <LogOut size={16} aria-hidden="true" />
    </button>
  );
}
