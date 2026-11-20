import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";

import { AppShell } from "@/components/app-shell";
import { OperationsProvider } from "@/components/operations-context";
import { OverviewDashboard } from "@/components/overview-dashboard";
import { PublicLandingPage } from "@/components/public-pages";
import { LocaleProvider } from "@/lib/client/use-locale";
import { creativeLocale } from "@/lib/creative-locale";
import { getAppOrigin, isAppHost, isMarketingHost, isSplitDomainMode } from "@/lib/public-urls";
import { buildPublicPageMetadata, landingJsonLd, serializeJsonLd } from "@/lib/seo";
import { requireTenant } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { loadPublicLaunchOffer } from "@/lib/server/launch-control";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await creativeLocale();
  if (isSplitDomainMode()) {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") || headerList.get("host");
    if (isAppHost(host)) {
      return {
        title: "Overview",
        robots: { index: false, follow: false },
      };
    }
  }
  return buildPublicPageMetadata("home", locale);
}

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

async function renderLanding(locale: "en" | "ar", appOrigin: string) {
  let launch100Active = true;
  let cohortFull = false;
  try {
    const launch = await loadPublicLaunchOffer(database());
    launch100Active = launch.launch100_active;
    cohortFull = launch.cohort_full;
  } catch {}
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(landingJsonLd(locale)) }}
      />
      <PublicLandingPage locale={locale} launch100Active={launch100Active} cohortFull={cohortFull} appOrigin={appOrigin} />
    </>
  );
}

export default async function OverviewPage() {
  const { locale } = await creativeLocale();
  const split = isSplitDomainMode();
  if (split) {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") || headerList.get("host");
    if (isMarketingHost(host)) {
      return renderLanding(locale, getAppOrigin());
    }
    if (isAppHost(host) && !(await hasLiveSession())) {
      redirect("/login");
    }
  }
  if (!(await hasLiveSession())) {
    return renderLanding(locale, split ? getAppOrigin() : "");
  }
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
