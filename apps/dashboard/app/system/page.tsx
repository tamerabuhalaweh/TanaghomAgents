import type { Metadata } from "next";
import { SystemView } from "@/components/system-view";

export const metadata: Metadata = { title: "System monitoring" };
export default function SystemPage() { return <SystemView />; }
