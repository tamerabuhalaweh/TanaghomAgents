import type { Metadata } from "next";

import { KnowledgeManagement } from "@/components/knowledge-management";

export const metadata: Metadata = { title: "Sales knowledge" };

export default function KnowledgePage() { return <KnowledgeManagement />; }
