import type { Metadata } from "next";
import { QualityRollout } from "@/components/quality-rollout";

export const metadata: Metadata = { title: "Quality & rollout" };
export default function QualityRolloutPage() { return <QualityRollout />; }
