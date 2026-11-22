"use client";

import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

import { useLocale } from "@/lib/client/use-locale";
import { invalidateSessionIdentity, loadSessionIdentity } from "@/lib/client/session-identity";

interface SessionUser {
  displayName: string;
  role: string;
}

const roles: Record<string, [string, string]> = {
  owner: ["Owner", "المالك"],
  operator: ["Operator", "المشغّل"],
  reviewer: ["Reviewer", "المراجع"],
  viewer: ["Viewer", "مشاهد"],
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function SessionProfile() {
  const { locale } = useLocale();
  const ar = locale === "ar";
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

  const role = user ? roles[user.role]?.[ar ? 1 : 0] ?? user.role : null;
  return (
    <button className="profile-switcher" type="button" onClick={() => void signOut()} disabled={signingOut} aria-label={user ? `${ar ? "تسجيل الخروج" : "Sign out"} ${user.displayName}` : (ar ? "تسجيل الخروج" : "Sign out")}>
      <span className="avatar">{user ? initials(user.displayName) : "—"}</span>
      <span className="profile-copy"><strong>{user?.displayName || (ar ? "جارٍ تحميل الملف الشخصي" : "Loading profile")}</strong><small>{role || (ar ? "جلسة موثّقة" : "Authenticated session")}</small></span>
      <LogOut size={16} aria-hidden="true" />
    </button>
  );
}
