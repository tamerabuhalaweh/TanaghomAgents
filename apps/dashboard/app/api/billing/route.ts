import type { NextRequest } from "next/server";

import { authorize, type ApplicationRole } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { loadLaunchOffer } from "@/lib/server/launch-control";
import { apiFailure, noStore } from "@/lib/server/responses";
import {
  PLAN_IDS,
  billingPlans,
  isStripeCheckoutConfigured,
  maskStripeCustomerId,
  stripeAutomaticTax,
  stripeCurrency,
  type PlanId,
  type TenantSubscriptionStatus,
} from "@/lib/server/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_ROLES: readonly ApplicationRole[] = ["owner", "operator", "reviewer", "viewer"];
const TENANT_STATUSES: readonly TenantSubscriptionStatus[] = ["trialing", "active", "past_due", "canceled"];

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  status: TenantSubscriptionStatus;
  stripe_customer_id: string | null;
  created_at: Date;
}

interface WebhookStateRow {
  action_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await authorize(request, ALL_ROLES);
    const organization = await database().query<OrganizationRow>(
      `SELECT id, name, slug, status, stripe_customer_id, created_at
         FROM tanaghom.organizations
        WHERE id = $1::uuid`,
      [user.organizationId],
    );
    const row = organization.rows[0];
    if (!row) return noStore({ error: "organization_not_found" }, { status: 404 });

    const latest = await database().query<WebhookStateRow>(
      `SELECT action_type, payload, created_at
         FROM tanaghom.agent_actions_log
        WHERE organization_id = $1::uuid
          AND entity_type = 'organization'
          AND entity_id = $1::uuid
          AND action_type LIKE 'billing.webhook.%'
          AND COALESCE((payload->>'stale_ignored')::boolean, false) = false
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [user.organizationId],
    );
    const payload = latest.rows[0]?.payload ?? {};
    const planValue = text(payload.plan_tier);
    const planTier = planValue && PLAN_IDS.includes(planValue as PlanId) ? planValue as PlanId : null;
    const currency = text(payload.currency);
    const status = TENANT_STATUSES.includes(row.status) ? row.status : "trialing";
    const owner = user.role === "owner";
    const launchOffer = await loadLaunchOffer(database(), user.organizationId, status === "active");

    return noStore({
      organization_id: row.id,
      organization_name: row.name,
      organization_slug: row.slug,
      subscription_status: status,
      plan_tier: planTier,
      stripe_price_id: text(payload.stripe_price_id),
      current_period_end: text(payload.current_period_end),
      cancel_at_period_end: payload.cancel_at_period_end === true,
      has_stripe_customer: Boolean(row.stripe_customer_id),
      stripe_customer_id_masked: owner ? maskStripeCustomerId(row.stripe_customer_id) : null,
      billing_configured: isStripeCheckoutConfigured(),
      can_manage_billing: owner,
      currency: currency && /^[a-z]{3}$/.test(currency) ? currency : stripeCurrency(),
      automatic_tax: stripeAutomaticTax(),
      plans: billingPlans(),
      launch_offer: launchOffer,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
