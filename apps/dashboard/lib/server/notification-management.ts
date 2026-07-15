import "server-only";

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize, type ApplicationUser } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import {
  encryptCredential,
  IntegrationCryptoError,
  integrationEncryptionConfigured,
} from "@/lib/server/integration-crypto";

const channels = ["email", "slack", "whatsapp"] as const;
const severities = ["info", "warning", "error", "critical"] as const;
const allowedEvents = [
  "queue_age",
  "interactive_backlog",
  "dependency_cooldown",
  "worker_unready",
  "dead_letter",
  "indeterminate_action",
  "database_unavailable",
] as const;

type NotificationChannel = typeof channels[number];
type NotificationSeverity = typeof severities[number];
type NotificationEvent = typeof allowedEvents[number];

interface DestinationRow {
  id: string;
  channel: NotificationChannel;
  label: string;
  status: "configured" | "disabled";
  target_last_four: string;
  minimum_severity: NotificationSeverity;
  event_types: NotificationEvent[];
  configured_by: string;
  created_at: string;
  updated_at: string;
}

interface DeliveryStatusRow {
  configured_destinations: number;
  selected_destinations: number;
  runtime_ready: boolean;
  emergency_stop: boolean;
  reason: string;
  delivery_ready: boolean;
  last_configured_at: string | null;
}

export class NotificationRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function parseChannel(value: unknown): NotificationChannel {
  if (typeof value !== "string" || !channels.includes(value as NotificationChannel)) {
    throw new NotificationRequestError("notification_channel_invalid");
  }
  return value as NotificationChannel;
}

function parseLabel(value: unknown) {
  const label = typeof value === "string" ? value.trim() : "";
  if (label.length < 3 || label.length > 80) throw new NotificationRequestError("notification_label_invalid");
  return label;
}

function parseSeverity(value: unknown): NotificationSeverity {
  if (typeof value !== "string" || !severities.includes(value as NotificationSeverity)) {
    throw new NotificationRequestError("notification_severity_invalid");
  }
  return value as NotificationSeverity;
}

function parseEvents(value: unknown): NotificationEvent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > allowedEvents.length) {
    throw new NotificationRequestError("notification_events_invalid");
  }
  const events = [...new Set(value)];
  if (events.some((event) => typeof event !== "string" || !allowedEvents.includes(event as NotificationEvent))) {
    throw new NotificationRequestError("notification_events_invalid");
  }
  return events as NotificationEvent[];
}

function validateTarget(channel: NotificationChannel, value: unknown) {
  const target = typeof value === "string" ? value.trim() : "";
  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    throw new NotificationRequestError("notification_email_invalid");
  }
  if (channel === "whatsapp" && !/^\+[1-9][0-9]{7,14}$/.test(target)) {
    throw new NotificationRequestError("notification_whatsapp_invalid");
  }
  if (channel === "slack") {
    let parsed: URL;
    try { parsed = new URL(target); } catch { throw new NotificationRequestError("notification_slack_webhook_invalid"); }
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.protocol !== "https:" || parsed.hostname !== "hooks.slack.com"
      || pathParts.length !== 4 || pathParts[0] !== "services" || pathParts.slice(1).some((part) => part.length < 3)
      || parsed.username || parsed.password
      || parsed.search || parsed.hash) {
      throw new NotificationRequestError("notification_slack_webhook_invalid");
    }
  }
  return target;
}

function publicDestination(row: DestinationRow) {
  return {
    id: row.id,
    channel: row.channel,
    label: row.label,
    status: row.status,
    target_mask: `••••${row.target_last_four}`,
    minimum_severity: row.minimum_severity,
    event_types: row.event_types,
    configured_by: row.configured_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function audit(client: PoolClient, user: ApplicationUser, destinationId: string, action: string, details: Record<string, unknown>) {
  await client.query(
    `INSERT INTO tanaghom.agent_actions_log
      (correlation_id,actor_user_id,action_type,entity_type,entity_id,payload,result)
     VALUES ($1,$2,$3,'notification_destination',$4,$5::jsonb,'success')`,
    [randomUUID(), user.id, action, destinationId, JSON.stringify(details)],
  );
}

async function deliveryStatus(organizationId: string) {
  const result = await database().query<DeliveryStatusRow>(
    `SELECT configured_destinations,selected_destinations,runtime_ready,emergency_stop,
            reason,delivery_ready,last_configured_at
       FROM tanaghom.notification_delivery_status WHERE organization_id=$1`,
    [organizationId],
  );
  return result.rows[0];
}

export function notificationApiError(error: unknown) {
  if (error instanceof NotificationRequestError) return error;
  if (error instanceof IntegrationCryptoError) return new NotificationRequestError(error.message, 503);
  return null;
}

export async function listNotificationDestinations(request: NextRequest) {
  const owner = await authorize(request, ["owner"]);
  const [destinations, delivery] = await Promise.all([
    database().query<DestinationRow>(
      `SELECT id,channel,label,status,target_last_four,minimum_severity,event_types,
              configured_by,created_at,updated_at
         FROM tanaghom.notification_destinations
        WHERE organization_id=$1 ORDER BY channel`,
      [owner.organizationId],
    ),
    deliveryStatus(owner.organizationId),
  ]);
  return {
    secure_storage_configured: integrationEncryptionConfigured(),
    delivery,
    destinations: destinations.rows.map(publicDestination),
    channel_definitions: [
      { channel: "email", label: "Email", target_label: "Alert email address", target_example: "operations@example.com", credential_source: "Tanaghom mail runtime" },
      { channel: "slack", label: "Slack", target_label: "Slack incoming webhook", target_example: "https://hooks.slack.com/services/…", credential_source: "Customer Slack workspace" },
      { channel: "whatsapp", label: "WhatsApp", target_label: "Escalation phone number", target_example: "+962790000000", credential_source: "Connected GoHighLevel account" },
    ],
    event_definitions: [
      { event: "queue_age", label: "Queue age warning" },
      { event: "interactive_backlog", label: "Interactive backlog" },
      { event: "dependency_cooldown", label: "Gemma or GHL cooldown" },
      { event: "worker_unready", label: "Worker unavailable" },
      { event: "dead_letter", label: "Dead-letter event" },
      { event: "indeterminate_action", label: "Uncertain provider action" },
      { event: "database_unavailable", label: "Database unavailable" },
    ],
  };
}

export async function saveNotificationDestination(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  const body = await request.json() as Record<string, unknown>;
  const channel = parseChannel(body.channel);
  const label = parseLabel(body.label);
  const target = validateTarget(channel, body.target);
  const severity = parseSeverity(body.minimum_severity);
  const events = parseEvents(body.event_types);
  const encrypted = encryptCredential(target);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<DestinationRow>(
      `INSERT INTO tanaghom.notification_destinations (
         organization_id,channel,label,status,target_ciphertext,target_nonce,target_auth_tag,
         target_key_version,target_last_four,minimum_severity,event_types,configured_by
       ) VALUES ($1,$2,$3,'configured',$4,$5,$6,$7,$8,$9,$10::text[],$11)
       ON CONFLICT (organization_id,channel) DO UPDATE SET
         label=EXCLUDED.label,status='configured',target_ciphertext=EXCLUDED.target_ciphertext,
         target_nonce=EXCLUDED.target_nonce,target_auth_tag=EXCLUDED.target_auth_tag,
         target_key_version=EXCLUDED.target_key_version,target_last_four=EXCLUDED.target_last_four,
         minimum_severity=EXCLUDED.minimum_severity,event_types=EXCLUDED.event_types,
         configured_by=EXCLUDED.configured_by
       RETURNING id,channel,label,status,target_last_four,minimum_severity,event_types,
                 configured_by,created_at,updated_at`,
      [owner.organizationId, channel, label, encrypted.ciphertext, encrypted.nonce,
       encrypted.authTag, encrypted.keyVersion, encrypted.lastFour, severity, events, owner.id],
    );
    await audit(client, owner, result.rows[0].id, "notification.destination_saved", {
      channel, minimum_severity: severity, event_count: events.length, key_version: encrypted.keyVersion,
    });
    await client.query("COMMIT");
    return { destination: publicDestination(result.rows[0]), delivery: await deliveryStatus(owner.organizationId) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function deleteNotificationDestination(request: NextRequest, id: string) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotificationRequestError("notification_destination_not_found", 404);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; channel: NotificationChannel }>(
      `DELETE FROM tanaghom.notification_destinations
        WHERE id=$1::uuid AND organization_id=$2 RETURNING id,channel`,
      [id, owner.organizationId],
    );
    if (!result.rows[0]) throw new NotificationRequestError("notification_destination_not_found", 404);
    await audit(client, owner, id, "notification.destination_deleted", { channel: result.rows[0].channel });
    await client.query("COMMIT");
    return { deleted: true, delivery: await deliveryStatus(owner.organizationId) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
