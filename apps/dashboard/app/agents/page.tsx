import type { Metadata } from "next";
import { AgentsWorkspace } from "@/components/agents-workspace";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return <AgentsWorkspace />;
}
