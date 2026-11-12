// Categories offered during onboarding. Every value is accepted by
// tanaghom.create_sales_knowledge_draft's category allowlist.
export const ONBOARDING_KNOWLEDGE_CATEGORIES = [
  "product",
  "service",
  "pricing",
  "faq",
  "policy",
  "offer",
  "location",
  "hours",
] as const;

export type OnboardingKnowledgeCategory = (typeof ONBOARDING_KNOWLEDGE_CATEGORIES)[number];

export function isOnboardingKnowledgeCategory(value: unknown): value is OnboardingKnowledgeCategory {
  return typeof value === "string"
    && (ONBOARDING_KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}
