import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import {
  evaluateLaunchGate,
  joinWaitlist,
  lockLaunchControl,
} from "@/lib/server/launch-control";
import { apiFailure, noStore } from "@/lib/server/responses";
import {
  PLAN_IDS,
  StripeBillingError,
  createStripeCheckoutSession,
  createStripeCustomer,
  createStripePortalSession,
  findActiveStripeSubscription,
  isStripeCheckoutConfigured,
  stripePriceIdFor,
  updateStripeCustomerMetadata,
  type PlanId,
} from "@/lib/server/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckoutOrganizationRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  stripe_customer_id: string | null;
}

interface CheckoutBody {
  plan_tier?: unknown;
  company_name?: unknown;
  tax_id_note?: unknown;
  locale?: unknown;
}

function failure(error: unknown) {
  if (error instanceof StripeBillingError) {
    return noStore({ error: error.code }, { status: error.status });
  }
  return apiFailure(error);
}

function cleanOptional(value: unknown, max: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOriginForCookieMutation(request);
    const user = await authorize(request, ["owner"]);
    const body = await request.json().catch(() => null) as CheckoutBody | null;
    const planTier = typeof body?.plan_tier === "string" ? body.plan_tier.trim() : "";
    if (!PLAN_IDS.includes(planTier as PlanId)) {
      return noStore({ error: "invalid_plan_tier" }, { status: 400 });
    }
    const planId = planTier as PlanId;
    if (!isStripeCheckoutConfigured() || !stripePriceIdFor(planId)) {
      return noStore({ error: "billing_not_configured" }, { status: 409 });
    }
    const companyName = cleanOptional(body?.company_name, 160);
    const taxIdNote = cleanOptional(body?.tax_id_note, 300);
    const locale = body?.locale === "ar" ? "ar" : "en";

    const client = await database().connect();
    let stripeCustomerId = "";
    let launch100 = false;
    let cohortMeta: { cohort_cap: number; active_workspaces: number } | null = null;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`stripe-billing:${user.organizationId}`],
      );
      await lockLaunchControl(client);
      const organization = await client.query<CheckoutOrganizationRow>(
        `SELECT id, name, slug, status, stripe_customer_id
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
      const activeSubscription = row.stripe_customer_id
        ? await findActiveStripeSubscription(row.stripe_customer_id)
        : null;
      if (row.stripe_customer_id && activeSubscription) {
        const portalSession = await createStripePortalSession(row.stripe_customer_id);
        await client.query(
          `INSERT INTO tanaghom.agent_actions_log
             (correlation_id, actor_user_id, action_type, entity_type, entity_id, organization_id, payload, result)
           VALUES ($1, $2, 'billing.portal_upgrade_opened', 'organization', $3::uuid, $3::uuid, $4::jsonb, 'success')`,
          [
            randomUUID(),
            user.id,
            user.organizationId,
            JSON.stringify({
              requested_plan_tier: planId,
              stripe_customer_id: row.stripe_customer_id,
              stripe_subscription_id: activeSubscription.id,
              portal_url_host: new URL(portalSession.url).host,
              current_status: row.status,
            }),
          ],
        );
        await client.query("COMMIT");
        return noStore({ url: portalSession.url, via: "portal" });
      }
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

      const gate = await evaluateLaunchGate(client, user.organizationId, { active: row.status === "active" });
      cohortMeta = {
        cohort_cap: gate.offer.cohort_cap,
        active_workspaces: gate.offer.active_workspaces,
      };
      if (gate.blocked) {
        const joined = await joinWaitlist(client, {
          organizationId: row.id,
          email,
          companyName: companyName || row.name,
          locale,
        });
        await client.query("COMMIT");
        return noStore({
          error: "launch_cohort_full",
          cohort_cap: gate.offer.cohort_cap,
          queue_position: joined.queue_position,
          active_workspaces: gate.offer.active_workspaces,
        }, { status: 409 });
      }
      launch100 = gate.offer.launch100_active;

      stripeCustomerId = row.stripe_customer_id || "";
      if (!stripeCustomerId) {
        const customer = await createStripeCustomer({
          email,
          name: row.name || user.displayName,
          organizationId: row.id,
          organizationSlug: row.slug,
          companyName,
        });
        stripeCustomerId = customer.id;
        await client.query(
          `UPDATE tanaghom.organizations
              SET stripe_customer_id = $2
            WHERE id = $1::uuid`,
          [row.id, stripeCustomerId],
        );
      } else if (companyName) {
        await updateStripeCustomerMetadata(stripeCustomerId, {
          organization_id: row.id,
          organization_slug: row.slug,
          company_name: companyName,
        });
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
      launch100,
      companyName,
      taxIdNote,
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
          launch100,
          promo_code: launch100 ? "LAUNCH100" : null,
          company_name: companyName || null,
          cohort: cohortMeta,
        }),
      ],
    );

    return noStore({ url: session.url, session_id: session.id, launch100 });
  } catch (error) {
    return failure(error);
  }
}
