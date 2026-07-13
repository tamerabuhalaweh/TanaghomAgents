import type { Metadata } from "next";
import { TeamManagement } from "@/components/team-management";

export const metadata: Metadata = { title: "Team & access" };
export default function TeamPage() { return <TeamManagement />; }
