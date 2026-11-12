import type { OnboardingIndustry } from "@/lib/onboarding-industries";

export interface OnboardingProfile {
  name: string;
  businessNameEn: string | null;
  businessNameAr: string | null;
  industry: OnboardingIndustry | null;
  location: string | null;
  completedAt: string | null;
  planStatus: string;
}
