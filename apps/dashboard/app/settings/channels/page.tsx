import type { Metadata } from "next";

import { ChannelsSettings } from "@/components/channels-settings";

export const metadata: Metadata = { title: "Social channels" };

export default function ChannelsPage() { return <ChannelsSettings />; }
