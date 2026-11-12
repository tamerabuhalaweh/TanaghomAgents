"use client";

import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

import { invalidateSessionIdentity, loadSessionIdentity } from "@/lib/client/session-identity";

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
    let active = true;
    void loadSessionIdentity().then((identity) => {
      if (active && identity) setUser(identity.user);
    });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    invalidateSessionIdentity();
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
