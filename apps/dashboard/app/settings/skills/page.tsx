import type { Metadata } from "next";

import { SettingsNavigation } from "@/components/settings-navigation";
import { SkillLibrary } from "@/components/skill-library";

export const metadata: Metadata = { title: "Skill Library" };

export default function SkillLibraryPage() {
  return <div className="page-stack"><SettingsNavigation /><SkillLibrary /></div>;
}
