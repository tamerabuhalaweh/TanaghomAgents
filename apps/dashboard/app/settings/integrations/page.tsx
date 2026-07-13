import type { Metadata } from "next";

import { IntegrationsSettings } from "@/components/integrations-settings";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() { return <IntegrationsSettings />; }
