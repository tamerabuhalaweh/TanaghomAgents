import type { Metadata } from "next";
import { TeamManagement } from "@/components/team-management";
import { creativeLocale } from "@/lib/creative-locale";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await creativeLocale();
  return {
    title: {
      absolute: locale === "ar" ? "الفريق والوصول · إعلاني" : "Team & access · E3lani",
    },
  };
}

export default function TeamPage() { return <TeamManagement />; }
