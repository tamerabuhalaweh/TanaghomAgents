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

export function stripeCurrency() {
  return (process.env.STRIPE_CURRENCY?.trim() || "gbp").toLowerCase();
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
  currency: string;
  interval: "month";
  configured: boolean;
}

export function billingPlans(): BillingPlan[] {
  return PLAN_DEFINITIONS.map((plan) => ({
    id: plan.id,
    amount_minor: plan.amountMinor,
    currency: stripeCurrency(),
    interval: plan.interval,
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
  body: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const key = stripeSecretKey();
  if (!key) throw new StripeBillingError("stripe_not_configured", 409);
  let response: Response;
  try {
    response = await fetch(`${stripeApiBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body.toString(),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Stripe API request failed", {
      path,
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
    const upstream = payload as { error?: { code?: unknown; type?: unknown } };
    const code = typeof upstream.error?.code === "string"
      ? upstream.error.code.slice(0, 120)
      : "stripe_request_failed";
    console.error("Stripe API rejected a request", { path, status: response.status, code });
    throw new StripeBillingError("stripe_request_failed", 502, response.status);
  }
  return payload as T;
}

export interface StripeCustomer {
  id: string;
}

export async function createStripeCustomer(input: {
  email: string;
  name: string;
  organizationId: string;
  organizationSlug: string;
}) {
  const form = stripeForm({
    email: input.email,
    name: input.name,
    "metadata[organization_id]": input.organizationId,
    "metadata[organization_slug]": input.organizationSlug,
  });
  const customer = await stripeRequest<StripeCustomer>("/v1/customers", form);
  if (!customer || typeof customer.id !== "string" || !customer.id.startsWith("cus_")) {
    throw new StripeBillingError("stripe_invalid_customer", 502);
  }
  return customer;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

export async function createStripeCheckoutSession(input: {
  organizationId: string;
  planId: PlanId;
  customerId: string;
}) {
  const priceId = stripePriceIdFor(input.planId);
  if (!priceId) throw new StripeBillingError("billing_not_configured", 409);
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
    "subscription_data[metadata][organization_id]": input.organizationId,
    "subscription_data[metadata][plan_tier]": input.planId,
    allow_promotion_codes: "true",
    "automatic_tax[enabled]": automaticTax ? "true" : "false",
    ...(automaticTax ? { "customer_update[address]": "auto" } : {}),
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
