import type { Metadata } from "next";

import { SecuritySettings } from "@/components/security-settings";
import { SettingsNavigation } from "@/components/settings-navigation";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return <div className="page-stack"><SettingsNavigation /><SecuritySettings /></div>;
}
