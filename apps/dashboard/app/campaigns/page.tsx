import type { Metadata } from "next";
import { CampaignsView } from "@/components/campaigns-view";

export const metadata: Metadata = { title: "Campaigns" };
export default function CampaignsPage() { return <CampaignsView />; }
