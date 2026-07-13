"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OperationsProvider } from "@/components/operations-context";

export function RootFrame({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/accept-invite") return children;
  return <OperationsProvider><AppShell>{children}</AppShell></OperationsProvider>;
}
