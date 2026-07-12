import type { Metadata } from "next";
import { ApprovalWorkspace } from "@/components/approval-workspace";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return <ApprovalWorkspace />;
}
