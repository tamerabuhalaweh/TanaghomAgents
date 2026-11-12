"use client";

import { useEffect, useState } from "react";

import { loadSessionIdentity } from "@/lib/client/session-identity";
import { useLocale } from "@/lib/client/use-locale";
import { tenantDisplayName, type TenantNames } from "@/lib/tenant-name";

export function TenantName({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const { locale } = useLocale();
  const [names, setNames] = useState<TenantNames | null>(null);

  useEffect(() => {
    let active = true;
    const apply = (organization: TenantNames | null) => {
      if (active && organization) setNames(organization);
    };
    const refresh = () => {
      void loadSessionIdentity(true).then((identity) => apply(identity?.organization ?? null));
    };
    void loadSessionIdentity().then((identity) => apply(identity?.organization ?? null));
    window.addEventListener("tanaghom:identity-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("tanaghom:identity-changed", refresh);
    };
  }, []);

  if (!names) return null;
  const label = tenantDisplayName(names, locale);
  return (
    <span
      className={variant === "mobile" ? "mobile-tenant-name" : "tenant-name"}
      title={label}
      aria-label={label}
    >
      {label}
    </span>
  );
}
