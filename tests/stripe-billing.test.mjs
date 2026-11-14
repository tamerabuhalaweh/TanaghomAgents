import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PLAN_DEFINITIONS,
  maskStripeCustomerId,
  mapStripeSubscriptionStatus,
  parseStripeSignatureHeader,
  verifyStripeWebhookSignature,
} from "../apps/dashboard/lib/server/stripe-billing-core.mjs";

const SECRET = "whsec_unit_test_secret";
const NOW = 1_700_000_000;
const BODY = JSON.stringify({ id: "evt_1", type: "invoice.paid", created: NOW });

function signature(rawBody, timestamp = NOW, secret = SECRET) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

test("accepts a valid current Stripe signature", () => {
  const result = verifyStripeWebhookSignature({
    rawBody: BODY,
    header: `t=${NOW},v1=${signature(BODY)}`,
    secret: SECRET,
    nowSeconds: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.timestamp, NOW);
});

test("rejects a tampered body without leaking the signature", () => {
  const result = verifyStripeWebhookSignature({
    rawBody: `${BODY} `,
    header: `t=${NOW},v1=${signature(BODY)}`,
    secret: SECRET,
    nowSeconds: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("rejects a signature made with a different secret", () => {
  const result = verifyStripeWebhookSignature({
    rawBody: BODY,
    header: `t=${NOW},v1=${signature(BODY, NOW, "whsec_other")}`,
    secret: SECRET,
    nowSeconds: NOW,
  });
  assert.equal(result.ok, false);
});

test("rejects timestamps older than 300 seconds", () => {
  const result = verifyStripeWebhookSignature({
    rawBody: BODY,
    header: `t=${NOW - 301},v1=${signature(BODY, NOW - 301)}`,
    secret: SECRET,
    nowSeconds: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timestamp_out_of_tolerance");
});

test("rejects timestamps more than 300 seconds in the future", () => {
  const result = verifyStripeWebhookSignature({
    rawBody: BODY,
    header: `t=${NOW + 301},v1=${signature(BODY, NOW + 301)}`,
    secret: SECRET,
    nowSeconds: NOW,
  });
  assert.equal(result.ok, false);
});

test("accepts any matching v1 token during secret rotation", () => {
  const oldSignature = signature(BODY, NOW, "whsec_old");
  const currentSignature = signature(BODY);
  const parsed = parseStripeSignatureHeader(`t=${NOW},v1=${oldSignature},v1=${currentSignature}`);
  assert.deepEqual(parsed.signatures, [oldSignature, currentSignature]);
  const result = verifyStripeWebhookSignature({
    rawBody: BODY,
    header: `t=${NOW},v1=${oldSignature},v1=${currentSignature}`,
    secret: SECRET,
    nowSeconds: NOW,
  });
  assert.equal(result.ok, true);
});

test("rejects a missing or malformed signature header", () => {
  assert.equal(verifyStripeWebhookSignature({ rawBody: BODY, header: null, secret: SECRET, nowSeconds: NOW }).ok, false);
  assert.equal(verifyStripeWebhookSignature({ rawBody: BODY, header: `t=${NOW}`, secret: SECRET, nowSeconds: NOW }).ok, false);
  assert.equal(verifyStripeWebhookSignature({ rawBody: BODY, header: `v1=${signature(BODY)}`, secret: SECRET, nowSeconds: NOW }).ok, false);
});

test("maps every Stripe subscription status onto the tenant contract", () => {
  assert.equal(mapStripeSubscriptionStatus("active"), "active");
  assert.equal(mapStripeSubscriptionStatus("trialing"), "trialing");
  assert.equal(mapStripeSubscriptionStatus("past_due"), "past_due");
  assert.equal(mapStripeSubscriptionStatus("unpaid"), "past_due");
  assert.equal(mapStripeSubscriptionStatus("incomplete"), "past_due");
  assert.equal(mapStripeSubscriptionStatus("canceled"), "canceled");
  assert.equal(mapStripeSubscriptionStatus("incomplete_expired"), "canceled");
  assert.equal(mapStripeSubscriptionStatus("paused"), "canceled");
  assert.equal(mapStripeSubscriptionStatus("unknown"), null);
});

test("publishes the exact GBP monthly plan catalogue", () => {
  assert.deepEqual(
    PLAN_DEFINITIONS.map(({ id, amountMinor, currency, interval }) => ({ id, amountMinor, currency, interval })),
    [
      { id: "starter", amountMinor: 24_900, currency: "gbp", interval: "month" },
      { id: "growth", amountMinor: 49_900, currency: "gbp", interval: "month" },
      { id: "scale", amountMinor: 79_900, currency: "gbp", interval: "month" },
    ],
  );
});

test("masks customer identifiers and rejects malformed values", () => {
  assert.equal(maskStripeCustomerId("cus_1234567890ABCD"), "cus_...ABCD");
  assert.equal(maskStripeCustomerId("not_a_customer"), null);
  assert.equal(maskStripeCustomerId(null), null);
});

test("checkout and portal return 409 billing_not_configured when unconfigured", () => {
  const checkout = readFileSync(
    new URL("../apps/dashboard/app/api/billing/checkout/route.ts", import.meta.url),
    "utf8",
  );
  const portal = readFileSync(
    new URL("../apps/dashboard/app/api/billing/portal/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(checkout, /error: "billing_not_configured"/);
  assert.match(checkout, /status: 409/);
  assert.match(portal, /error: "billing_not_configured"/);
  assert.match(portal, /status: 409/);
});

test("the Stripe server module adds no npm dependency", () => {
  const source = readFileSync(
    new URL("../apps/dashboard/lib/server/stripe-billing.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /node:fs/);
  assert.doesNotMatch(source, /from "stripe"|require\("stripe"\)|@stripe\//);
  assert.doesNotMatch(source, /node_modules/);
});
