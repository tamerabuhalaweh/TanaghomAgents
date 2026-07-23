import type { Metadata } from "next";

import { AgentStudio } from "@/components/agent-studio";
import { SettingsNavigation } from "@/components/settings-navigation";

export const metadata: Metadata = { title: "Agent Studio" };

export default function AgentStudioPage() {
  return <div className="page-stack"><SettingsNavigation /><AgentStudio /></div>;
}
