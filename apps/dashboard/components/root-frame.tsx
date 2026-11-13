"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OperationsProvider } from "@/components/operations-context";

// These routes must render without the authenticated shell: the shell loads
// operations and refreshes the session, which would bounce a signed-out visitor
// from signup back to login before they can create a workspace.
const PUBLIC_ROUTES = new Set([
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
]);

export function RootFrame({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  if (PUBLIC_ROUTES.has(pathname)) return children;
  return <OperationsProvider><AppShell>{children}</AppShell></OperationsProvider>;
}
