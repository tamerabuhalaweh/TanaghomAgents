// Industries offered during onboarding. Shared by the server validator and the
// client form so the accepted values and the visible options cannot drift.

export const ONBOARDING_INDUSTRIES = [
  "retail_ecommerce",
  "food_hospitality",
  "services_consulting",
  "education_training",
  "health_wellness",
  "beauty_personal_care",
  "real_estate",
  "creative_media",
  "technology",
  "nonprofit",
  "other",
] as const;

export type OnboardingIndustry = (typeof ONBOARDING_INDUSTRIES)[number];

export function isOnboardingIndustry(value: unknown): value is OnboardingIndustry {
  return typeof value === "string" && (ONBOARDING_INDUSTRIES as readonly string[]).includes(value);
}
