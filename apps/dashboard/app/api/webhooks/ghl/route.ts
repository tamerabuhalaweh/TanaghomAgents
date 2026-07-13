import type { NextRequest } from "next/server";

import {
  acceptGhlWebhook,
  GhlWebhookNormalizationError,
  normalizeGhlWebhook,
  recordGhlWebhookRejection,
  sha256,
  verifyGhlWebhookSignature,
} from "@/lib/server/ghl-inbound-webhook";
import { noStore } from "@/lib/server/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumBodyBytes = 256 * 1024;

function response(body: unknown, status: number, webhookStatus: string, startedAt: number) {
  const result = noStore(body, { status });
  result.headers.set("X-Tanaghom-Webhook-Status", webhookStatus);
  result.headers.set("Server-Timing", `ingress;dur=${(performance.now() - startedAt).toFixed(1)}`);
  return result;
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  if (process.env.GHL_WEBHOOK_INGRESS_ENABLED !== "true") {
    await recordGhlWebhookRejection("ingress_disabled");
    return response({ error: "ghl_webhook_ingress_disabled" }, 503, "disabled", startedAt);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) {
    await recordGhlWebhookRejection("payload_too_large");
    return response({ error: "payload_too_large" }, 413, "rejected", startedAt);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    await recordGhlWebhookRejection("content_type_invalid");
    return response({ error: "content_type_invalid" }, 415, "rejected", startedAt);
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  const bodyHash = sha256(rawBody);
  if (rawBody.length > maximumBodyBytes) {
    await recordGhlWebhookRejection("payload_too_large", bodyHash);
    return response({ error: "payload_too_large" }, 413, "rejected", startedAt);
  }

  const signature = verifyGhlWebhookSignature(rawBody, request.headers.get("x-ghl-signature"));
  if (!signature.ok) {
    await recordGhlWebhookRejection(signature.reason, bodyHash);
    return response({ error: signature.reason }, 401, "rejected", startedAt);
  }

  let providerPayload: unknown;
  try {
    providerPayload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    await recordGhlWebhookRejection("invalid_json", bodyHash);
    return response({ accepted: false, reason: "invalid_json" }, 202, "ignored", startedAt);
  }

  let normalized;
  try {
    normalized = normalizeGhlWebhook(providerPayload, bodyHash);
  } catch (error) {
    const reason = error instanceof GhlWebhookNormalizationError ? error.reason : "invalid_event";
    await recordGhlWebhookRejection(reason, bodyHash);
    return response({ accepted: false, reason }, 202, "ignored", startedAt);
  }

  try {
    const accepted = await acceptGhlWebhook(normalized, bodyHash);
    if (!accepted) throw new Error("inbound_event_not_returned");
    return response({
      accepted: true,
      duplicate: accepted.duplicate,
      event_id: accepted.event_id,
      status: accepted.event_status,
      delivery_count: accepted.delivery_count,
    }, accepted.duplicate ? 200 : 202, accepted.duplicate ? "duplicate" : "accepted", startedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ghl_inbound_location_not_configured")) {
      await recordGhlWebhookRejection("location_unconfigured", bodyHash);
      return response({ accepted: false, reason: "location_unconfigured" }, 202, "ignored", startedAt);
    }
    if (message.includes("invalid_ghl_inbound_event_contract")) {
      await recordGhlWebhookRejection("invalid_event", bodyHash);
      return response({ accepted: false, reason: "invalid_event" }, 202, "ignored", startedAt);
    }
    console.error(JSON.stringify({ event: "ghl_webhook_accept_failed", body_sha256: bodyHash }));
    return response({ error: "webhook_inbox_unavailable" }, 503, "retry", startedAt);
  }
}
