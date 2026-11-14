import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import {
  StripeBillingError,
  createStripePortalSession,
  isStripePortalConfigured,
} from "@/lib/server/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    if (!isStripePortalConfigured()) {
      return noStore({ error: "billing_not_configured" }, { status: 409 });
    }

    const organization = await database().query<{ stripe_customer_id: string | null }>(
      "SELECT stripe_customer_id FROM tanaghom.organizations WHERE id = $1::uuid",
      [user.organizationId],
    );
    const stripeCustomerId = organization.rows[0]?.stripe_customer_id;
    if (!organization.rows[0]) return noStore({ error: "organization_not_found" }, { status: 404 });
    if (!stripeCustomerId) return noStore({ error: "billing_customer_not_found" }, { status: 409 });

    const session = await createStripePortalSession(stripeCustomerId);
    await database().query(
      `INSERT INTO tanaghom.agent_actions_log
         (correlation_id, actor_user_id, action_type, entity_type, entity_id, organization_id, payload, result)
       VALUES ($1, $2, 'billing.portal_opened', 'organization', $3::uuid, $3::uuid, $4::jsonb, 'success')`,
      [
        randomUUID(),
        user.id,
        user.organizationId,
        JSON.stringify({
          stripe_customer_id: stripeCustomerId,
          portal_url_host: new URL(session.url).host,
        }),
      ],
    );
    return noStore({ url: session.url });
  } catch (error) {
    return failure(error);
  }
}
