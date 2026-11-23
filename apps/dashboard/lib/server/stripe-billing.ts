import "server-only";

import { readFileSync } from "node:fs";

import {
  PLAN_DEFINITIONS,
  PLAN_IDS,
  maskStripeCustomerId,
  mapStripeSubscriptionStatus,
  verifyStripeWebhookSignature,
  type PlanId,
  type TenantSubscriptionStatus,
} from "@/lib/server/stripe-billing-core.mjs";

export {
  PLAN_DEFINITIONS,
  PLAN_IDS,
  maskStripeCustomerId,
  mapStripeSubscriptionStatus,
  verifyStripeWebhookSignature,
};
export type { PlanId, TenantSubscriptionStatus };

const PLAN_ENV: Record<PlanId, string> = {
  starter: "STRIPE_PRICE_ID_STARTER",
  growth: "STRIPE_PRICE_ID_GROWTH",
  scale: "STRIPE_PRICE_ID_SCALE",
};

const LAUNCH100_PRICE_ENV: Record<PlanId, string> = {
  starter: "STRIPE_LAUNCH100_PRICE_ID_STARTER",
  growth: "STRIPE_LAUNCH100_PRICE_ID_GROWTH",
  scale: "STRIPE_LAUNCH100_PRICE_ID_SCALE",
};

const LAUNCH100_COUPON_ENV: Record<PlanId, string> = {
  starter: "STRIPE_LAUNCH100_COUPON_ID_STARTER",
  growth: "STRIPE_LAUNCH100_COUPON_ID_GROWTH",
  scale: "STRIPE_LAUNCH100_COUPON_ID_SCALE",
};

const REQUEST_TIMEOUT_MS = 12_000;

export class StripeBillingError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 502,
    public readonly upstreamStatus?: number,
  ) {
    super(code);
  }
}

function secretValue(envName: string, fileEnvName: string, fallbackFile: string) {
  const direct = process.env[envName]?.trim();
  if (direct) return direct;
  const file = process.env[fileEnvName]?.trim() || fallbackFile;
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

/** The Stripe API key, from the environment or the mounted Docker secret. */
export function stripeSecretKey() {
  return secretValue("STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_FILE", "/run/secrets/stripe_secret_key");
}

/** The endpoint secret used to verify Stripe-Signature on inbound webhooks. */
export function stripeWebhookSecret() {
  return secretValue(
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_WEBHOOK_SECRET_FILE",
    "/run/secrets/stripe_webhook_secret",
  );
}

export function stripePriceIdFor(planId: PlanId) {
  return process.env[PLAN_ENV[planId]]?.trim() || "";
}

export function stripeLaunch100PriceIdFor(planId: PlanId) {
  return process.env[LAUNCH100_PRICE_ENV[planId]]?.trim() || "";
}

export function stripeLaunch100DiscountFor(planId: PlanId) {
  const coupon = process.env[LAUNCH100_COUPON_ENV[planId]]?.trim();
  if (coupon) return { field: "discounts[0][coupon]", id: coupon } as const;
  const promotionCode = process.env.STRIPE_LAUNCH100_PROMOTION_CODE_ID?.trim();
  if (promotionCode) return { field: "discounts[0][promotion_code]", id: promotionCode } as const;
  return null;
}

export function stripeCurrency() {
  return (process.env.STRIPE_CURRENCY?.trim() || "usd").toLowerCase();
}

export function stripeAutomaticTax() {
  return process.env.STRIPE_AUTOMATIC_TAX?.trim().toLowerCase() === "true";
}

export function stripeApiBaseUrl() {
  const raw = process.env.STRIPE_API_BASE_URL?.trim() || "https://api.stripe.com";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StripeBillingError("stripe_configuration_invalid", 503);
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new StripeBillingError("stripe_configuration_invalid", 503);
  }
  return url.toString().replace(/\/+$/, "");
}

export function appBaseUrl() {
  const raw = process.env.APP_BASE_URL?.trim() || "http://127.0.0.1:3210";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StripeBillingError("app_base_url_invalid", 503);
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new StripeBillingError("app_base_url_invalid", 503);
  }
  return raw.replace(/\/+$/, "");
}

/** Checkout needs both an API key and at least one configured recurring price. */
export function isStripeCheckoutConfigured() {
  const key = stripeSecretKey();
  return (key.startsWith("sk_") || key.startsWith("rk_"))
    && PLAN_IDS.some((planId) => Boolean(stripePriceIdFor(planId)));
}

/** The portal needs only the API key and an existing Stripe customer. */
export function isStripePortalConfigured() {
  const key = stripeSecretKey();
  return key.startsWith("sk_") || key.startsWith("rk_");
}

export interface BillingPlan {
  id: PlanId;
  amount_minor: number;
  promo_amount_minor: number;
  currency: string;
  interval: "month";
  monthly_campaigns: number;
  configured: boolean;
}

export function billingPlans(): BillingPlan[] {
  return PLAN_DEFINITIONS.map((plan) => ({
    id: plan.id,
    amount_minor: plan.amountMinor,
    promo_amount_minor: plan.promoAmountMinor,
    currency: stripeCurrency(),
    interval: plan.interval,
    monthly_campaigns: plan.monthlyCampaigns,
    configured: Boolean(stripePriceIdFor(plan.id)),
  }));
}

export function planIdForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const planId of PLAN_IDS) {
    if (stripePriceIdFor(planId) === priceId) return planId;
  }
  return null;
}

function stripeForm(values: Record<string, string | number | boolean | undefined>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    form.set(key, String(value));
  }
  return form;
}

async function stripeRequest<T>(
  path: string,
  body?: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const key = stripeSecretKey();
  if (!key) throw new StripeBillingError("stripe_not_configured", 409);
  const method = body ? "POST" : "GET";
  let response: Response;
  try {
    response = await fetch(`${stripeApiBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body ? { body: body.toString() } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Stripe API request failed", {
      path,
      method,
      reason: error instanceof Error ? error.name : "network_error",
    });
    throw new StripeBillingError("stripe_unavailable", 502);
  }

  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const upstream = payload as {
      error?: { code?: unknown; type?: unknown; param?: unknown; message?: unknown };
    };
    const code = typeof upstream.error?.code === "string"
      ? upstream.error.code.slice(0, 120)
      : "stripe_request_failed";
    const type = typeof upstream.error?.type === "string"
      ? upstream.error.type.slice(0, 80)
      : undefined;
    const param = typeof upstream.error?.param === "string"
      ? upstream.error.param.slice(0, 80)
      : undefined;
    const message = typeof upstream.error?.message === "string"
      ? upstream.error.message.slice(0, 300)
      : undefined;
    const requestId = response.headers.get("request-id")?.slice(0, 120) || undefined;
    console.error("Stripe API rejected a request", {
      path,
      method,
      status: response.status,
      code,
      ...(type ? { type } : {}),
      ...(param ? { param } : {}),
      ...(requestId ? { requestId } : {}),
      ...(message ? { message } : {}),
    });
    throw new StripeBillingError("stripe_request_failed", 502, response.status);
  }
  return payload as T;
}

export interface StripeActiveSubscription {
  id: string;
  status: "active";
}

/**
 * Look up whether the Stripe customer actually holds an active subscription.
 * Returns null if none exists so customers without a live subscription go through Checkout.
 */
export async function findActiveStripeSubscription(
  customerId: string,
): Promise<StripeActiveSubscription | null> {
  const params = new URLSearchParams({
    customer: customerId,
    status: "active",
    limit: "1",
  });
  const list = await stripeRequest<{ data?: Array<{ id?: unknown; status?: unknown }> }>(
    `/v1/subscriptions?${params.toString()}`,
  );
  const first = list?.data?.[0];
  if (typeof first?.id === "string" && first.id.startsWith("sub_") && first.status === "active") {
    return { id: first.id, status: "active" };
  }
  return null;
}

export interface StripeCustomer {
  id: string;
}

export async function createStripeCustomer(input: {
  email: string;
  name: string;
  organizationId: string;
  organizationSlug: string;
  companyName?: string;
}) {
  const form = stripeForm({
    email: input.email,
    name: input.name,
    "metadata[organization_id]": input.organizationId,
    "metadata[organization_slug]": input.organizationSlug,
    "metadata[company_name]": input.companyName,
  });
  const customer = await stripeRequest<StripeCustomer>("/v1/customers", form);
  if (!customer || typeof customer.id !== "string" || !customer.id.startsWith("cus_")) {
    throw new StripeBillingError("stripe_invalid_customer", 502);
  }
  return customer;
}

export async function updateStripeCustomerMetadata(
  customerId: string,
  metadata: Record<string, string | undefined>,
) {
  const form = stripeForm(Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [`metadata[${key}]`, value]),
  ));
  await stripeRequest<Record<string, unknown>>(`/v1/customers/${encodeURIComponent(customerId)}`, form);
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

export async function createStripeCheckoutSession(input: {
  organizationId: string;
  planId: PlanId;
  customerId: string;
  launch100: boolean;
  companyName?: string;
  taxIdNote?: string;
}) {
  const launchPriceId = input.launch100 ? stripeLaunch100PriceIdFor(input.planId) : "";
  const standardPriceId = stripePriceIdFor(input.planId);
  const priceId = launchPriceId || standardPriceId;
  if (!priceId) throw new StripeBillingError("billing_not_configured", 409);
  const discount = input.launch100 && !launchPriceId
    ? stripeLaunch100DiscountFor(input.planId)
    : null;
  const automaticTax = stripeAutomaticTax();
  const base = appBaseUrl();
  const form = stripeForm({
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.organizationId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    "metadata[organization_id]": input.organizationId,
    "metadata[plan_tier]": input.planId,
    "metadata[company_name]": input.companyName,
    "metadata[tax_id_note]": input.taxIdNote,
    ...(input.launch100 ? {
      "metadata[promo_code]": "LAUNCH100",
      "subscription_data[metadata][promo_code]": "LAUNCH100",
    } : {}),
    "subscription_data[metadata][organization_id]": input.organizationId,
    "subscription_data[metadata][plan_tier]": input.planId,
    ...(discount
      ? { [discount.field]: discount.id }
      : input.launch100 && !launchPriceId
        ? { allow_promotion_codes: "true" }
        : input.launch100
          ? {}
          : { allow_promotion_codes: "true" }),
    billing_address_collection: "required",
    "tax_id_collection[enabled]": "true",
    "customer_update[name]": "auto",
    "customer_update[address]": "auto",
    "automatic_tax[enabled]": automaticTax ? "true" : "false",
    success_url: `${base}/settings/billing?checkout=success`,
    cancel_url: `${base}/settings/billing?checkout=cancelled`,
  });
  const session = await stripeRequest<StripeCheckoutSession>("/v1/checkout/sessions", form);
  if (!session || typeof session.id !== "string" || !validRedirectUrl(session.url)) {
    throw new StripeBillingError("stripe_invalid_checkout_session", 502);
  }
  return session;
}

export interface StripePortalSession {
  url: string;
}

export async function createStripePortalSession(customerId: string) {
  const form = stripeForm({
    customer: customerId,
    return_url: `${appBaseUrl()}/settings/billing`,
  });
  const session = await stripeRequest<StripePortalSession>("/v1/billing_portal/sessions", form);
  if (!session || !validRedirectUrl(session.url)) {
    throw new StripeBillingError("stripe_invalid_portal_session", 502);
  }
  return session;
}

function validRedirectUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
