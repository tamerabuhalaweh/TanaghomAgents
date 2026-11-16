import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { AppShell } from "@/components/app-shell";
import { OperationsProvider } from "@/components/operations-context";
import { OverviewDashboard } from "@/components/overview-dashboard";
import { PublicLandingPage } from "@/components/public-pages";
import { LocaleProvider } from "@/lib/client/use-locale";
import { creativeLocale } from "@/lib/creative-locale";
import { requireTenant } from "@/lib/server/authorization";

async function hasLiveSession() {
  const token = (await cookies()).get("tanaghom_access_token")?.value;
  if (!token) return false;
  try {
    const request = new NextRequest("http://localhost/", {
      headers: { cookie: `tanaghom_access_token=${token}` },
    });
    await requireTenant(request);
    return true;
  } catch {
    // A missing, expired or revoked session is a signed-out visitor. The public
    // landing page is the correct surface, never a broken dashboard shell.
    return false;
  }
}

export default async function OverviewPage() {
  const { locale } = await creativeLocale();
  if (!(await hasLiveSession())) return <PublicLandingPage locale={locale} />;
  return (
    <LocaleProvider initialLocale={locale}>
      <OperationsProvider>
        <AppShell>
          <OverviewDashboard />
        </AppShell>
      </OperationsProvider>
    </LocaleProvider>
  );
}
