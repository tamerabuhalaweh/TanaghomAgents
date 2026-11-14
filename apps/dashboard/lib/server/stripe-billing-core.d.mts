export type PlanId = "starter" | "growth" | "scale";
export type TenantSubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface PlanDefinition {
  readonly id: PlanId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly interval: "month";
}

export const PLAN_DEFINITIONS: readonly PlanDefinition[];
export const PLAN_IDS: readonly PlanId[];

export function parseStripeSignatureHeader(header: string | null | undefined): {
  timestamp: number | null;
  signatures: string[];
};

export function verifyStripeWebhookSignature(input: {
  rawBody: string;
  header: string | null | undefined;
  secret: string;
  nowSeconds?: number;
}): { ok: boolean; reason?: string; timestamp?: number };

export function mapStripeSubscriptionStatus(status: string | null | undefined): TenantSubscriptionStatus | null;

export function maskStripeCustomerId(value: string | null | undefined): string | null;
