import type { Metadata } from "next";
import { CampaignDetailView } from "@/components/campaign-detail-view";

export const metadata: Metadata = { title: "Campaign details" };
export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetailView campaignId={id} />;
}
