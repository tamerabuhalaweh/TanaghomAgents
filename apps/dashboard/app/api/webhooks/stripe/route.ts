import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";

import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import {
  PLAN_IDS,
  mapStripeSubscriptionStatus,
  planIdForPriceId,
  stripePriceIdFor,
  stripeWebhookSecret,
  verifyStripeWebhookSignature,
  type PlanId,
  type TenantSubscriptionStatus,
} from "@/lib/server/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 262_144;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIFECYCLE_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.paid",
  "charge.refunded",
]);
const TENANT_STATUSES: readonly TenantSubscriptionStatus[] = ["trialing", "active", "past_due", "canceled"];

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

interface OrganizationRow {
  id: string;
  status: TenantSubscriptionStatus;
  stripe_customer_id: string | null;
}

interface AuditActor {
  actor_user_id: string | null;
  agent_id: string | null;
}

interface BillingPayload {
  plan_tier?: unknown;
  stripe_price_id?: unknown;
  stripe_subscription_id?: unknown;
  current_period_end?: unknown;
  cancel_at_period_end?: unknown;
  currency?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function customerIdFrom(value: unknown) {
  if (typeof value === "string" && value.startsWith("cus_")) return value;
  const record = object(value);
  return typeof record.id === "string" && record.id.startsWith("cus_") ? record.id : null;
}

function subscriptionIdFrom(value: unknown) {
  if (typeof value === "string" && value.startsWith("sub_")) return value;
  const record = object(value);
  return typeof record.id === "string" && record.id.startsWith("sub_") ? record.id : null;
}

function metadataOrganizationId(value: unknown) {
  const candidate = stringValue(object(value).organization_id);
  return candidate && UUID_RE.test(candidate) ? candidate : null;
}

function eventOrganizationId(event: StripeEvent) {
  const data = object(event.data.object);
  const candidates = [
    metadataOrganizationId(data.metadata),
    stringValue(data.client_reference_id),
    metadataOrganizationId(object(data.subscription_details).metadata),
    metadataOrganizationId(object(object(data.parent).subscription_details).metadata),
  ];
  return candidates.find((value) => value && UUID_RE.test(value)) || null;
}

function eventCustomerId(event: StripeEvent) {
  const data = object(event.data.object);
  return customerIdFrom(data.customer)
    || customerIdFrom(object(data.subscription_details).customer)
    || null;
}

function firstSubscriptionItem(data: Record<string, unknown>) {
  const items = object(data.items).data;
  return Array.isArray(items) ? object(items[0]) : {};
}

function firstInvoiceLine(data: Record<string, unknown>) {
  const lines = object(data.lines).data;
  return Array.isArray(lines) ? object(lines[0]) : {};
}

function eventPriceId(event: StripeEvent) {
  const data = object(event.data.object);
  return stringValue(object(firstSubscriptionItem(data).price).id)
    || stringValue(object(firstInvoiceLine(data).price).id)
    || stringValue(object(data.plan).id)
    || null;
}

function eventPlanTier(event: StripeEvent, priceId: string | null): PlanId | null {
  const data = object(event.data.object);
  const metadataValues = [
    data.metadata,
    object(data.subscription_details).metadata,
    object(object(data.parent).subscription_details).metadata,
  ];
  for (const metadata of metadataValues) {
    const candidate = stringValue(object(metadata).plan_tier);
    if (candidate && PLAN_IDS.includes(candidate as PlanId)) return candidate as PlanId;
  }
  const fromPrice = planIdForPriceId(priceId);
  if (fromPrice) return fromPrice;
  return null;
}

function eventPromoCode(event: StripeEvent) {
  const data = object(event.data.object);
  const metadataValues = [
    data.metadata,
    object(data.subscription_details).metadata,
    object(object(data.parent).subscription_details).metadata,
  ];
  for (const metadata of metadataValues) {
    const candidate = stringValue(object(metadata).promo_code);
    if (candidate) return candidate.slice(0, 80);
  }
  return null;
}

function eventCompanyName(event: StripeEvent) {
  const data = object(event.data.object);
  return stringValue(object(data.metadata).company_name)
    || stringValue(object(object(object(data.parent).subscription_details).metadata).company_name)
    || null;
}

function isFullRefund(event: StripeEvent) {
  if (event.type !== "charge.refunded") return false;
  const data = object(event.data.object);
  const amount = Number(data.amount);
  const refunded = Number(data.amount_refunded);
  return Number.isSafeInteger(amount) && amount > 0
    && Number.isSafeInteger(refunded) && refunded >= amount;
}

function isoFromUnix(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

function eventCurrentPeriodEnd(event: StripeEvent) {
  const data = object(event.data.object);
  return isoFromUnix(data.current_period_end)
    || isoFromUnix(object(firstSubscriptionItem(data)).current_period_end)
    || isoFromUnix(object(firstInvoiceLine(data).period).end)
    || isoFromUnix(data.period_end)
    || null;
}

function eventCancelAtPeriodEnd(event: StripeEvent) {
  const data = object(event.data.object);
  if (typeof data.cancel_at_period_end === "boolean") return data.cancel_at_period_end;
  const details = object(data.subscription_details);
  return typeof details.cancel_at_period_end === "boolean" ? details.cancel_at_period_end : null;
}

function eventCurrency(event: StripeEvent) {
  const data = object(event.data.object);
  const value = stringValue(data.currency) || stringValue(object(data.subscription_details).currency);
  return value && /^[a-z]{3}$/i.test(value) ? value.toLowerCase() : null;
}

function eventStatus(event: StripeEvent): TenantSubscriptionStatus | null {
  const data = object(event.data.object);
  if (event.type === "customer.subscription.deleted" || event.type === "invoice.payment_failed") {
    return event.type === "invoice.payment_failed" ? "past_due" : "canceled";
  }
  if (event.type === "invoice.payment_action_required") return "past_due";
  if (event.type === "charge.refunded") return isFullRefund(event) ? "canceled" : null;
  if (event.type === "invoice.paid" || event.type === "checkout.session.completed") return "active";
  return mapStripeSubscriptionStatus(stringValue(data.status));
}

async function resolveActor(client: PoolClient, organizationId: string): Promise<AuditActor> {
  const human = await client.query<{ id: string }>(
    `SELECT id
       FROM tanaghom.app_users
      WHERE organization_id = $1::uuid
        AND kind = 'human'
      ORDER BY (role = 'owner') DESC, created_at ASC
      LIMIT 1`,
    [organizationId],
  );
  if (human.rows[0]) return { actor_user_id: human.rows[0].id, agent_id: null };

  const agent = await client.query<{ id: string }>(
    "SELECT id FROM tanaghom.agents ORDER BY created_at ASC LIMIT 1",
  );
  return { actor_user_id: null, agent_id: agent.rows[0]?.id || null };
}

async function insertAudit(
  client: PoolClient,
  input: {
    actor: AuditActor;
    organizationId: string;
    event: StripeEvent;
    payload: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO tanaghom.agent_actions_log
       (correlation_id, agent_id, actor_user_id, action_type, entity_type, entity_id, organization_id, payload, result)
     VALUES ($1, $2, $3, $4, 'organization', $5::uuid, $5::uuid, $6::jsonb, 'success')`,
    [
      randomUUID(),
      input.actor.agent_id,
      input.actor.actor_user_id,
      `billing.webhook.${input.event.type}`,
      input.organizationId,
      JSON.stringify(input.payload),
    ],
  );
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
      return noStore({ error: "payload_too_large" }, { status: 413 });
    }
    const body = Buffer.from(await request.arrayBuffer());
    if (body.byteLength > MAX_WEBHOOK_BYTES) {
      return noStore({ error: "payload_too_large" }, { status: 413 });
    }

    const secret = stripeWebhookSecret();
    if (!secret) return noStore({ error: "stripe_webhook_not_configured" }, { status: 503 });

    const rawBody = body.toString("utf8");
    const verified = verifyStripeWebhookSignature({
      rawBody,
      header: request.headers.get("stripe-signature"),
      secret,
    });
    if (!verified.ok) {
      return noStore({ error: "invalid_stripe_signature" }, { status: 400 });
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      return noStore({ error: "invalid_payload" }, { status: 400 });
    }
    if (
      !event
      || typeof event.id !== "string"
      || !event.id.trim()
      || typeof event.type !== "string"
      || !Number.isSafeInteger(event.created)
      || !event.data
      || typeof event.data !== "object"
    ) {
      return noStore({ error: "invalid_payload" }, { status: 400 });
    }
    if (!LIFECYCLE_EVENTS.has(event.type)) {
      return noStore({ received: true, ignored: true });
    }

    const data = object(event.data.object);
    const customerId = eventCustomerId(event);
    const priceId = eventPriceId(event);
    const planTier = eventPlanTier(event, priceId);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      let organizationId = eventOrganizationId(event);
      if (!organizationId && customerId) {
        const byCustomer = await client.query<{ id: string }>(
          "SELECT id FROM tanaghom.organizations WHERE stripe_customer_id = $1",
          [customerId],
        );
        organizationId = byCustomer.rows[0]?.id || null;
      }
      if (!organizationId) {
        await client.query("ROLLBACK");
        return noStore({ received: true, unmatched: true });
      }

      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`stripe-billing:${organizationId}`],
      );
      const organization = await client.query<OrganizationRow>(
        `SELECT id, status, stripe_customer_id
           FROM tanaghom.organizations
          WHERE id = $1::uuid
          FOR UPDATE`,
        [organizationId],
      );
      const row = organization.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return noStore({ received: true, unmatched: true });
      }

      const duplicate = await client.query(
        `SELECT 1
           FROM tanaghom.agent_actions_log
          WHERE organization_id = $1::uuid
            AND action_type LIKE 'billing.webhook.%'
            AND payload->>'stripe_event_id' = $2
          LIMIT 1`,
        [organizationId, event.id],
      );
      if (duplicate.rows.length > 0) {
        await client.query("COMMIT");
        return noStore({ received: true, duplicate: true });
      }

      if (customerId) {
        const conflict = await client.query<{ id: string }>(
          `SELECT id FROM tanaghom.organizations
            WHERE stripe_customer_id = $1 AND id <> $2::uuid`,
          [customerId, organizationId],
        );
        if (conflict.rows.length > 0) {
          await client.query("ROLLBACK");
          return noStore({ error: "stripe_customer_conflict" }, { status: 409 });
        }
      }

      const previous = await client.query<{ payload: BillingPayload }>(
        `SELECT payload
           FROM tanaghom.agent_actions_log
          WHERE organization_id = $1::uuid
            AND entity_type = 'organization'
            AND entity_id = $1::uuid
            AND action_type LIKE 'billing.webhook.%'
            AND COALESCE((payload->>'stale_ignored')::boolean, false) = false
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [organizationId],
      );
      const previousPayload = previous.rows[0]?.payload ?? {};
      const previousCreated = Number(previousPayload.stripe_event_created);
      const stale = Number.isSafeInteger(previousCreated) && previousCreated > event.created;
      const previousStatus = stringValue(previousPayload.status);
      const previousPlan = stringValue(previousPayload.plan_tier);
      const previousPrice = stringValue(previousPayload.stripe_price_id);
      const previousSubscription = stringValue(previousPayload.stripe_subscription_id);
      const previousPeriodEnd = stringValue(previousPayload.current_period_end);
      const previousCancel = typeof previousPayload.cancel_at_period_end === "boolean"
        ? previousPayload.cancel_at_period_end
        : null;
      const previousCurrency = stringValue(previousPayload.currency);

      const incomingStatus = eventStatus(event);
      const status = stale
        ? TENANT_STATUSES.includes(previousStatus as TenantSubscriptionStatus)
          ? previousStatus as TenantSubscriptionStatus
          : row.status
        : incomingStatus
          || (TENANT_STATUSES.includes(previousStatus as TenantSubscriptionStatus)
            ? previousStatus as TenantSubscriptionStatus
            : row.status);
      const resolvedPlan = planTier
        || (previousPlan && PLAN_IDS.includes(previousPlan as PlanId) ? previousPlan as PlanId : null);
      const resolvedPrice = priceId
        || previousPrice
        || (resolvedPlan ? stripePriceIdFor(resolvedPlan) || null : null);
      const subscriptionId = subscriptionIdFrom(data.id)
        || subscriptionIdFrom(data.subscription)
        || subscriptionIdFrom(object(data.subscription_details).subscription)
        || previousSubscription;
      const periodEnd = eventCurrentPeriodEnd(event) || previousPeriodEnd;
      const cancelAtPeriodEnd = eventCancelAtPeriodEnd(event);
      const currency = eventCurrency(event) || previousCurrency;
      const payload: Record<string, unknown> = {
        stripe_event_id: event.id,
        stripe_event_type: event.type,
        stripe_event_created: event.created,
        stale_ignored: stale,
        status,
        plan_tier: resolvedPlan,
        stripe_price_id: resolvedPrice,
        stripe_subscription_id: subscriptionId,
        current_period_end: periodEnd,
        cancel_at_period_end: cancelAtPeriodEnd === null ? previousCancel : cancelAtPeriodEnd,
        currency,
        stripe_customer_id: customerId || row.stripe_customer_id,
        promo_code: eventPromoCode(event),
        company_name: eventCompanyName(event),
        refunded: event.type === "charge.refunded",
        full_refund: isFullRefund(event),
      };

      const actor = await resolveActor(client, organizationId);
      if (!actor.actor_user_id && !actor.agent_id) {
        await client.query("ROLLBACK");
        return noStore({ error: "billing_audit_actor_unavailable" }, { status: 503 });
      }

      if (!stale) {
        await client.query(
          `UPDATE tanaghom.organizations
              SET status = $2,
                  stripe_customer_id = COALESCE(stripe_customer_id, $3)
            WHERE id = $1::uuid`,
          [organizationId, status, customerId],
        );
      }
      await insertAudit(client, { actor, organizationId, event, payload });
      await client.query("COMMIT");
      return noStore({ received: true, stale_ignored: stale || undefined });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return apiFailure(error);
  }
}
