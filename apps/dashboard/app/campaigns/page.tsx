import type { Metadata } from "next";
import { CampaignsView } from "@/components/campaigns-view";
import { creativeLocale } from "@/lib/creative-locale";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await creativeLocale();
  return {
    title: {
      absolute: locale === "ar" ? "الحملات · إعلاني" : "Campaigns · E3lani",
    },
  };
}

export default function CampaignsPage() { return <CampaignsView />; }
