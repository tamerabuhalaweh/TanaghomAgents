import "server-only";

import { createHash, verify } from "node:crypto";

import { database } from "@/lib/server/database";

const GHL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

const supportedEvents = new Set([
  "InboundMessage",
  "OutboundMessage",
  "ContactCreate",
  "ContactUpdate",
  "ContactDndUpdate",
  "ConversationUnreadWebhook",
]);

const channels = new Map<string, string>([
  ["WHATSAPP", "whatsapp"],
  ["IG", "instagram"],
  ["INSTAGRAM", "instagram"],
  ["FB", "facebook"],
  ["FACEBOOK", "facebook"],
  ["SMS", "sms"],
  ["EMAIL", "email"],
  ["LIVE_CHAT", "live_chat"],
  ["LIVE CHAT", "live_chat"],
  ["GMB", "gmb"],
  ["CALL", "call"],
  ["VOICEMAIL", "voicemail"],
]);

export type GhlWebhookRejectionReason =
  | "ingress_disabled"
  | "payload_too_large"
  | "content_type_invalid"
  | "signature_missing"
  | "signature_invalid"
  | "invalid_json"
  | "unsupported_event"
  | "invalid_event"
  | "location_unconfigured";

export class GhlWebhookNormalizationError extends Error {
  constructor(readonly reason: GhlWebhookRejectionReason) {
    super(reason);
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : undefined;
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.slice(0, maximumItems)
    .flatMap((entry) => {
      const item = boundedString(entry, maximumLength);
      return item ? [item] : [];
    });
  return normalized.length ? normalized : undefined;
}

function boundedDnd(value: unknown) {
  if (typeof value === "boolean") return value;
  if (!isObject(value)) return undefined;
  const safe: JsonObject = {};
  for (const [key, entry] of Object.entries(value).slice(0, 20)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key) || /token|secret|password|authorization|api.?key/i.test(key)) continue;
    if (typeof entry === "boolean" || typeof entry === "number") safe[key] = entry;
    if (typeof entry === "string") safe[key] = entry.slice(0, 160);
  }
  return safe;
}

function eventData(value: JsonObject) {
  return isObject(value.data) ? value.data : value;
}

function first(source: JsonObject, outer: JsonObject, names: string[], maximum: number) {
  for (const name of names) {
    const candidate = boundedString(source[name] ?? outer[name], maximum);
    if (candidate) return candidate;
  }
  return undefined;
}

function integer(source: JsonObject, outer: JsonObject, names: string[]) {
  for (const name of names) {
    const value = source[name] ?? outer[name];
    if (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000) return Number(value);
  }
  return undefined;
}

function occurredAt(source: JsonObject, outer: JsonObject, receivedAt: Date) {
  const raw = first(source, outer, ["dateAdded", "timestamp", "occurredAt"], 100);
  if (!raw) return receivedAt.toISOString();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) throw new GhlWebhookNormalizationError("invalid_event");
  return parsed.toISOString();
}

export function sha256(rawBody: Buffer) {
  return createHash("sha256").update(rawBody).digest("hex");
}

function webhookPublicKey() {
  const configured = process.env.GHL_WEBHOOK_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n").trim();
  return configured || GHL_ED25519_PUBLIC_KEY;
}

export function verifyGhlWebhookSignature(rawBody: Buffer, signature: string | null) {
  if (!signature || signature === "N/A") return { ok: false as const, reason: "signature_missing" as const };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length > 256) {
    return { ok: false as const, reason: "signature_invalid" as const };
  }
  try {
    const decoded = Buffer.from(signature, "base64");
    if (decoded.length !== 64) return { ok: false as const, reason: "signature_invalid" as const };
    return verify(null, rawBody, webhookPublicKey(), decoded)
      ? { ok: true as const }
      : { ok: false as const, reason: "signature_invalid" as const };
  } catch {
    return { ok: false as const, reason: "signature_invalid" as const };
  }
}

export function normalizeGhlWebhook(value: unknown, bodyHash: string, receivedAt = new Date()) {
  if (!isObject(value)) throw new GhlWebhookNormalizationError("invalid_event");
  const source = eventData(value);
  const eventType = first(source, value, ["type"], 100);
  if (!eventType || !supportedEvents.has(eventType)) {
    throw new GhlWebhookNormalizationError("unsupported_event");
  }
  const locationId = first(source, value, ["locationId", "location_id"], 100);
  if (!locationId || !/^[A-Za-z0-9_-]{3,100}$/.test(locationId)) {
    throw new GhlWebhookNormalizationError("invalid_event");
  }

  const messageType = first(source, value, ["messageType", "channel"], 80)?.toUpperCase();
  const details: JsonObject = {};
  const detailStrings: Array<[string, string[], number]> = [
    ["body", ["body", "message"], 32768],
    ["subject", ["subject"], 1000],
    ["content_type", ["contentType"], 160],
    ["status", ["status"], 160],
    ["source", ["source"], 160],
    ["from", ["from"], 500],
    ["to", ["to"], 500],
    ["first_name", ["firstName", "first_name"], 300],
    ["last_name", ["lastName", "last_name"], 300],
    ["email", ["email"], 500],
    ["phone", ["phone"], 160],
  ];
  for (const [target, names, maximum] of detailStrings) {
    const result = first(source, value, names, maximum);
    if (result !== undefined) details[target] = result;
  }
  const attachments = stringArray(source.attachments ?? value.attachments, 20, 2048);
  const tags = stringArray(source.tags ?? value.tags, 100, 160);
  const unreadCount = integer(source, value, ["unreadCount", "unread_count"]);
  const dnd = boundedDnd(source.dnd ?? source.dndSettings ?? value.dnd ?? value.dndSettings);
  if (attachments) details.attachments = attachments;
  if (tags) details.tags = tags;
  if (unreadCount !== undefined) details.unread_count = unreadCount;
  if (dnd !== undefined) details.dnd = dnd;

  const providerEventId = first(source, value, ["webhookId", "eventId"], 300) || `sha256:${bodyHash}`;
  const inferredDirection = eventType === "InboundMessage"
    ? "inbound"
    : eventType === "OutboundMessage" ? "outbound" : "system";
  const requestedDirection = first(source, value, ["direction"], 20)?.toLowerCase();
  const direction = requestedDirection === "inbound" || requestedDirection === "outbound"
    ? requestedDirection : inferredDirection;

  return {
    contract_version: "phase5.ghl-inbound-event.v1",
    provider_event_id: providerEventId,
    provider_event_type: eventType,
    location_id: locationId,
    contact_id: first(source, value, eventType.startsWith("Contact") ? ["contactId", "id"] : ["contactId"], 300) || null,
    conversation_id: first(source, value, ["conversationId"], 300) || null,
    message_id: first(source, value, ["messageId", "emailMessageId"], 300) || null,
    channel: eventType.includes("Message") ? channels.get(messageType || "") || "unknown" : "system",
    direction,
    occurred_at: occurredAt(source, value, receivedAt),
    details,
  };
}

export async function recordGhlWebhookRejection(reason: GhlWebhookRejectionReason, bodyHash?: string) {
  try {
    await database().query("SELECT tanaghom.record_ghl_webhook_rejection($1,$2)", [reason, bodyHash || null]);
  } catch {
    console.warn(JSON.stringify({ event: "ghl_webhook_rejected", reason, body_sha256: bodyHash || null, audit_persisted: false }));
  }
}

export async function acceptGhlWebhook(normalized: ReturnType<typeof normalizeGhlWebhook>, bodyHash: string) {
  const result = await database().query<{
    event_id: string;
    organization_id: string;
    event_status: string;
    duplicate: boolean;
    delivery_count: number;
  }>("SELECT * FROM tanaghom.accept_ghl_inbound_event($1::jsonb,$2)", [JSON.stringify(normalized), bodyHash]);
  return result.rows[0];
}
