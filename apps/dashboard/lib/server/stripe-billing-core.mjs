import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The public plan catalogue. Price IDs are resolved from the environment by
 * the server wrapper so this module stays deterministic and unit-testable.
 */
export const PLAN_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "starter", amountMinor: 4_900, promoAmountMinor: 1_500, currency: "usd", interval: "month", monthlyCampaigns: 15 }),
  Object.freeze({ id: "growth", amountMinor: 12_900, promoAmountMinor: 2_500, currency: "usd", interval: "month", monthlyCampaigns: 50 }),
  Object.freeze({ id: "scale", amountMinor: 24_900, promoAmountMinor: 5_000, currency: "usd", interval: "month", monthlyCampaigns: 200 }),
]);

export const PLAN_IDS = Object.freeze(PLAN_DEFINITIONS.map((plan) => plan.id));

const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Parse a Stripe-Signature header. Multiple v1 values are supported so a
 * webhook secret can be rotated without dropping signed events.
 */
export function parseStripeSignatureHeader(header) {
  if (typeof header !== "string" || !header.trim()) {
    return { timestamp: null, signatures: [] };
  }
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!value) continue;
    if (key === "t") {
      timestamp = /^\d+$/.test(value) ? Number(value) : Number.NaN;
    } else if (key === "v1") {
      signatures.push(value.toLowerCase());
    }
  }
  return { timestamp, signatures };
}

/**
 * Constant-time verification of a Stripe webhook. The raw body must be the
 * exact UTF-8 string Stripe signed; callers must not parse and re-serialize it.
 */
export function verifyStripeWebhookSignature({
  rawBody,
  header,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, reason: "missing_secret" };
  }
  if (typeof rawBody !== "string") {
    return { ok: false, reason: "invalid_payload" };
  }
  const parsed = parseStripeSignatureHeader(header);
  if (
    !Number.isSafeInteger(parsed.timestamp)
    || Math.abs(nowSeconds - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }
  if (parsed.signatures.length === 0) {
    return { ok: false, reason: "missing_signature" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`, "utf8")
    .digest();
  let matched = false;
  for (const candidate of parsed.signatures) {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) continue;
    const supplied = Buffer.from(candidate, "hex");
    if (supplied.length !== expected.length) continue;
    if (timingSafeEqual(supplied, expected)) matched = true;
  }
  return matched
    ? { ok: true, timestamp: parsed.timestamp }
    : { ok: false, reason: "signature_mismatch" };
}

/** Map every Stripe subscription status onto the four tenant statuses. */
export function mapStripeSubscriptionStatus(status) {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      return null;
  }
}

/** Never return a full Stripe customer identifier to a browser. */
export function maskStripeCustomerId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^cus_[A-Za-z0-9]+$/.test(trimmed)) return null;
  if (trimmed.length <= 8) return "cus_...";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
