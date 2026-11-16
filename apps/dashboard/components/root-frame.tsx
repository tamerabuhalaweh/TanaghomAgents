"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OperationsProvider } from "@/components/operations-context";
import { LocaleProvider } from "@/lib/client/use-locale";
import type { CreativeLocale } from "@/lib/i18n/creative";

// These routes must render without the authenticated shell: the shell loads
// operations and refreshes the session, which would bounce a signed-out visitor
// from signup back to login before they can create a workspace.
const PUBLIC_ROUTES = new Set([
  "/",
  "/pricing",
  "/privacy",
  "/terms",
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
]);

export function RootFrame({ children, initialLocale = "en" }: Readonly<{ children: React.ReactNode; initialLocale?: CreativeLocale }>) {
  const pathname = usePathname();
  if (PUBLIC_ROUTES.has(pathname)) return children;
  return (
    <LocaleProvider initialLocale={initialLocale}>
      <OperationsProvider><AppShell>{children}</AppShell></OperationsProvider>
    </LocaleProvider>
  );
}
