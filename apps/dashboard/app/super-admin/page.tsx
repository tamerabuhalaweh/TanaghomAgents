import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextRequest } from "next/server";

import { SuperAdminConsole } from "@/components/super-admin-console";
import { creativeLocale } from "@/lib/creative-locale";
import { requireSuperAdmin } from "@/lib/server/super-admin";

export const metadata: Metadata = { title: "Platform cockpit", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const { locale, dir } = await creativeLocale();
  const headerList = new Headers(await headers());
  const request = new NextRequest("http://tanaghom.internal/super-admin", { headers: headerList });
  try {
    await requireSuperAdmin(request);
  } catch {
    notFound();
  }
  return <SuperAdminConsole initialLocale={locale} dir={dir} />;
}
