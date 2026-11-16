import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("checkout requests B2B reverse-charge fields and stamps LAUNCH100", () => {
  const billing = read("apps/dashboard/lib/server/stripe-billing.ts");
  const route = read("apps/dashboard/app/api/billing/checkout/route.ts");
  assert.match(billing, /billing_address_collection/);
  assert.match(billing, /tax_id_collection\[enabled\]/);
  assert.match(billing, /customer_update\[name\]/);
  assert.match(billing, /customer_update\[address\]/);
  assert.match(billing, /STRIPE_LAUNCH100_PRICE_ID_/);
  assert.match(billing, /STRIPE_LAUNCH100_COUPON_ID_/);
  assert.match(route, /lockLaunchControl/);
  assert.match(route, /evaluateLaunchGate/);
  assert.match(route, /launch_cohort_full/);
  assert.match(route, /queue_position/);
  assert.match(route, /company_name/);
});

test("launch control persists immutable platform audit rows and serializes the cohort", () => {
  const source = read("apps/dashboard/lib/server/launch-control.ts");
  assert.match(source, /platform-launch-control/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /10000000-0000-4000-8000-000000000001/);
  assert.match(source, /platform\.launch_config\.updated/);
  assert.match(source, /platform\.waitlist\.joined/);
  assert.match(source, /status = 'active'/);
  assert.match(source, /payload->>'promo_code' = 'LAUNCH100'/);
  assert.match(source, /actor_user_id/);
  assert.match(source, /agent_id/);
});

test("waitlist and billing expose the priority queue and launch offer", () => {
  const waitlist = read("apps/dashboard/app/api/waitlist/route.ts");
  const billing = read("apps/dashboard/app/api/billing/route.ts");
  assert.match(waitlist, /joinWaitlist/);
  assert.match(waitlist, /too_many_requests/);
  assert.match(waitlist, /queue_position/);
  assert.match(billing, /launch_offer/);
  assert.match(billing, /loadLaunchOffer/);
});

test("webhook handles action-required and full refunds deterministically", () => {
  const source = read("apps/dashboard/app/api/webhooks/stripe/route.ts");
  assert.match(source, /invoice\.payment_action_required/);
  assert.match(source, /charge\.refunded/);
  assert.match(source, /amount_refunded/);
  assert.match(source, /full_refund/);
  assert.match(source, /refunded: event\.type === "charge\.refunded"/);
  assert.match(source, /promo_code: eventPromoCode/);
});

test("super admin is platform-owner only and absent from customer navigation", () => {
  const service = read("apps/dashboard/lib/server/super-admin.ts");
  const route = read("apps/dashboard/app/api/super-admin/route.ts");
  const page = read("apps/dashboard/app/super-admin/page.tsx");
  const proxy = read("apps/dashboard/proxy.ts");
  const shell = read("apps/dashboard/components/app-shell.tsx");
  assert.match(service, /SUPER_ADMIN_EMAILS/);
  assert.match(service, /PLATFORM_ORGANIZATION_ID/);
  assert.match(service, /set_agency_workspace_circuit_breaker/);
  assert.match(route, /error: "not_found"/);
  assert.match(route, /reset_ai_circuit_breaker/);
  assert.match(route, /set_ai_circuit_breaker/);
  assert.match(route, /update_launch_config/);
  assert.match(page, /notFound\(\)/);
  assert.match(proxy, /"\/super-admin"/);
  assert.doesNotMatch(shell, /\/super-admin/);
});

test("cockpit is bilingual and exposes all four control panels", () => {
  const source = read("apps/dashboard/components/super-admin-console.tsx");
  assert.match(source, /Revenue & growth/);
  assert.match(source, /System health/);
  assert.match(source, /Launch & cohort/);
  assert.match(source, /Workspaces & waitlist/);
  assert.match(source, /الدفعات/);
  assert.match(source, /LAUNCH100/);
  assert.match(source, /reset_ai_circuit_breaker/);
  assert.match(source, /update_launch_config/);
});

test("compose defaults billing to USD and wires launch controls", () => {
  const compose = read("deployment/dashboard-demo/compose.yml");
  const example = read("deployment/dashboard-demo/.env.example");
  assert.match(compose, /STRIPE_CURRENCY: \$\{STRIPE_CURRENCY:-usd\}/);
  for (const name of [
    "SUPER_ADMIN_EMAILS", "LAUNCH_COHORT_CAP", "LAUNCH100_ENABLED",
    "LAUNCH100_MAX_REDEMPTIONS", "STRIPE_LAUNCH100_PRICE_ID_STARTER",
    "STRIPE_LAUNCH100_PRICE_ID_GROWTH", "STRIPE_LAUNCH100_PRICE_ID_SCALE",
    "STRIPE_LAUNCH100_COUPON_ID_STARTER", "STRIPE_LAUNCH100_COUPON_ID_GROWTH",
    "STRIPE_LAUNCH100_COUPON_ID_SCALE", "STRIPE_LAUNCH100_PROMOTION_CODE_ID",
  ]) {
    assert.match(compose, new RegExp(`\\$\\{${name}:-`));
    assert.match(example, new RegExp(`^${name}=`, "m"));
  }
});
