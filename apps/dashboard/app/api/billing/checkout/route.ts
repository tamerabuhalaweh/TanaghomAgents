import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import {
  PLAN_IDS,
  StripeBillingError,
  createStripeCheckoutSession,
  createStripeCustomer,
  isStripeCheckoutConfigured,
  stripePriceIdFor,
  type PlanId,
} from "@/lib/server/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckoutOrganizationRow {
  id: string;
  name: string;
  slug: string;
  stripe_customer_id: string | null;
}

function failure(error: unknown) {
  if (error instanceof StripeBillingError) {
    return noStore({ error: error.code }, { status: error.status });
  }
  return apiFailure(error);
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOriginForCookieMutation(request);
    const user = await authorize(request, ["owner"]);
    const body = await request.json().catch(() => null) as { plan_tier?: unknown } | null;
    const planTier = typeof body?.plan_tier === "string" ? body.plan_tier.trim() : "";
    if (!PLAN_IDS.includes(planTier as PlanId)) {
      return noStore({ error: "invalid_plan_tier" }, { status: 400 });
    }
    const planId = planTier as PlanId;
    if (!isStripeCheckoutConfigured() || !stripePriceIdFor(planId)) {
      return noStore({ error: "billing_not_configured" }, { status: 409 });
    }

    const client = await database().connect();
    let stripeCustomerId = "";
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`stripe-billing:${user.organizationId}`],
      );
      const organization = await client.query<CheckoutOrganizationRow>(
        `SELECT id, name, slug, stripe_customer_id
           FROM tanaghom.organizations
          WHERE id = $1::uuid
          FOR UPDATE`,
        [user.organizationId],
      );
      const row = organization.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return noStore({ error: "organization_not_found" }, { status: 404 });
      }

      stripeCustomerId = row.stripe_customer_id || "";
      if (!stripeCustomerId) {
        const profile = await client.query<{ email: string }>(
          `SELECT email FROM tanaghom.app_users
            WHERE id = $1::uuid AND organization_id = $2::uuid AND kind = 'human'`,
          [user.id, user.organizationId],
        );
        const email = profile.rows[0]?.email;
        if (!email) {
          await client.query("ROLLBACK");
          return noStore({ error: "billing_customer_profile_missing" }, { status: 409 });
        }
        const customer = await createStripeCustomer({
          email,
          name: row.name || user.displayName,
          organizationId: row.id,
          organizationSlug: row.slug,
        });
        stripeCustomerId = customer.id;
        await client.query(
          `UPDATE tanaghom.organizations
              SET stripe_customer_id = $2
            WHERE id = $1::uuid`,
          [row.id, stripeCustomerId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const session = await createStripeCheckoutSession({
      organizationId: user.organizationId,
      planId,
      customerId: stripeCustomerId,
    });

    await database().query(
      `INSERT INTO tanaghom.agent_actions_log
         (correlation_id, actor_user_id, action_type, entity_type, entity_id, organization_id, payload, result)
       VALUES ($1, $2, 'billing.checkout_started', 'organization', $3::uuid, $3::uuid, $4::jsonb, 'success')`,
      [
        randomUUID(),
        user.id,
        user.organizationId,
        JSON.stringify({
          plan_tier: planId,
          stripe_price_id: stripePriceIdFor(planId),
          stripe_customer_id: stripeCustomerId,
          stripe_session_id: session.id,
          checkout_url_host: new URL(session.url).host,
        }),
      ],
    );

    return noStore({ url: session.url, session_id: session.id });
  } catch (error) {
    return failure(error);
  }
}
