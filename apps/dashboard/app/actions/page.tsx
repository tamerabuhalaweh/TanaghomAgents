import type { Metadata } from "next";
import { GhlActionReview } from "@/components/ghl-action-review";

export const metadata: Metadata = { title: "Agent action review" };
export default function AgentActionReviewPage() { return <GhlActionReview />; }
