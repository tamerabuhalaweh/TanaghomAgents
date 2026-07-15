import "server-only";

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { integrationEncryptionConfigured } from "@/lib/server/integration-crypto";

export type PostizAutomationMode = "manual" | "automatic" | "paused";
export type GhlActionMode = "manual" | "shadow" | "assisted" | "bounded_autonomous";

interface AutomationStatusRow {
  postiz_draft_mode: PostizAutomationMode;
  changed_at: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  emergency_stop: boolean;
  emergency_stop_reason: string;
  connection_ready: boolean;
  channel_mapping_ready: boolean;
  operations_clear: boolean;
}

interface GhlActionStatusRow {
  action_mode: GhlActionMode;
  proactive_message_mode: "disabled" | "approved_templates";
  action_emergency_stop: boolean;
  action_emergency_reason: string;
  action_allowed_channels: string[];
  action_quiet_hours_start: string;
  action_quiet_hours_end: string;
  action_timezone: string;
  action_contact_frequency_cap_24h: number;
  action_policy_changed_by: string | null;
  action_policy_changed_at: string | null;
  platform_emergency_stop: boolean;
  connection_ready: boolean;
  operations_clear: boolean;
  changed_by_name: string | null;
}

export class AutomationRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function gatewayUrlReady() {
  const raw = process.env.TANAGHOM_INTEGRATION_GATEWAY_URL?.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    return parsed.protocol === "https:" || (
      process.env.APP_ENV === "integration" && parsed.protocol === "http:" && parsed.hostname === "127.0.0.1"
    );
  } catch { return false; }
}

export function postizAutomationRuntimeBlockers() {
  const blockers: string[] = [];
  if (process.env.POSTIZ_AUTOMATION_RUNTIME_READY !== "true") blockers.push("runtime_not_enabled");
  if (!integrationEncryptionConfigured()) blockers.push("credential_vault_not_ready");
  if ((process.env.INTEGRATION_WORKER_TOKEN || "").length < 32) blockers.push("worker_authentication_not_ready");
  if (!gatewayUrlReady()) blockers.push("gateway_not_ready");
  return blockers;
}

export function postizAutomationRuntimeReady() {
  return postizAutomationRuntimeBlockers().length === 0;
}

export function ghlActionRuntimeBlockers() {
  const blockers: string[] = [];
  if (process.env.GHL_ACTION_RUNTIME_READY !== "true") blockers.push("runtime_not_enabled");
  if (!integrationEncryptionConfigured()) blockers.push("credential_vault_not_ready");
  if ((process.env.INTEGRATION_WORKER_TOKEN || "").length < 32) blockers.push("worker_authentication_not_ready");
  if (!gatewayUrlReady()) blockers.push("gateway_not_ready");
  return blockers;
}

export function ghlActionRuntimeReady() { return ghlActionRuntimeBlockers().length === 0; }

export async function getGhlActionAutomationStatus(organizationId: string) {
  const result = await database().query<GhlActionStatusRow>(
    `SELECT status.*, actor.display_name AS changed_by_name
       FROM tanaghom.ghl_action_automation_status status
       LEFT JOIN tanaghom.app_users actor ON actor.id=status.action_policy_changed_by
      WHERE status.organization_id=$1`,
    [organizationId],
  );
  const row = result.rows[0];
  if (!row) throw new AutomationRequestError("ghl_action_policy_not_found", 503);
  const runtimeBlockers = ghlActionRuntimeBlockers();
  const blockers = [
    ...(row.platform_emergency_stop ? ["platform_emergency_stop"] : []),
    ...(row.action_emergency_stop ? ["organization_emergency_stop"] : []),
    ...runtimeBlockers,
    ...(!row.connection_ready ? ["ghl_connection_not_ready"] : []),
    ...(!row.operations_clear ? ["indeterminate_ghl_action"] : []),
  ];
  return {
    mode: row.action_mode,
    proactive_message_mode: row.proactive_message_mode,
    emergency_stop: row.action_emergency_stop,
    emergency_stop_reason: row.action_emergency_reason,
    policy: {
      allowed_channels: row.action_allowed_channels,
      quiet_hours_start: row.action_quiet_hours_start,
      quiet_hours_end: row.action_quiet_hours_end,
      timezone: row.action_timezone,
      contact_frequency_cap_24h: row.action_contact_frequency_cap_24h,
    },
    changed_at: row.action_policy_changed_at,
    changed_by: row.action_policy_changed_by
      ? { id: row.action_policy_changed_by, display_name: row.changed_by_name || "Tanaghom Admin" } : null,
    readiness: {
      runtime_ready: runtimeBlockers.length === 0,
      connection_ready: row.connection_ready,
      operations_clear: row.operations_clear,
      platform_clear: !row.platform_emergency_stop,
      organization_clear: !row.action_emergency_stop,
      ready_for_automation: blockers.length === 0,
      blockers,
    },
  };
}

export async function getPostizAutomationStatus(organizationId: string) {
  const result = await database().query<AutomationStatusRow>(
    `SELECT status.postiz_draft_mode, status.changed_at, status.changed_by,
            actor.display_name AS changed_by_name, status.emergency_stop,
            status.emergency_stop_reason, status.connection_ready,
            status.channel_mapping_ready, status.operations_clear
       FROM tanaghom.postiz_automation_status status
       LEFT JOIN tanaghom.app_users actor ON actor.id = status.changed_by
      WHERE status.organization_id = $1`,
    [organizationId],
  );
  const row = result.rows[0];
  if (!row) throw new AutomationRequestError("automation_policy_not_found", 503);
  const runtimeBlockers = postizAutomationRuntimeBlockers();
  const blockers = [
    ...(row.emergency_stop ? ["platform_emergency_stop"] : []),
    ...runtimeBlockers,
    ...(!row.connection_ready ? ["postiz_connection_not_ready"] : []),
    ...(!row.channel_mapping_ready ? ["postiz_channel_mapping_not_ready"] : []),
    ...(!row.operations_clear ? ["indeterminate_postiz_operation"] : []),
  ];
  return {
    mode: row.postiz_draft_mode,
    changed_at: row.changed_at,
    changed_by: row.changed_by ? { id: row.changed_by, display_name: row.changed_by_name || "Tanaghom Admin" } : null,
    emergency_stop: row.emergency_stop,
    emergency_stop_reason: row.emergency_stop_reason,
    readiness: {
      runtime_ready: runtimeBlockers.length === 0,
      connection_ready: row.connection_ready,
      channel_mapping_ready: row.channel_mapping_ready,
      operations_clear: row.operations_clear,
      ready_for_automatic: blockers.length === 0,
      blockers,
    },
  };
}

function mapAutomationDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("active owner")) return new AutomationRequestError("forbidden", 403);
  if (message.includes("GHL action runtime is not ready")) return new AutomationRequestError("ghl_action_runtime_not_ready", 409);
  if (message.includes("GHL action emergency stop")) return new AutomationRequestError("ghl_action_emergency_stopped", 409);
  if (message.includes("connected GHL integration")) return new AutomationRequestError("ghl_connection_not_ready", 409);
  if (message.includes("indeterminate GHL action")) return new AutomationRequestError("indeterminate_ghl_action", 409);
  if (message.includes("valid GHL action mode")) return new AutomationRequestError("ghl_action_mode_invalid", 400);
  if (message.includes("runtime is not ready")) return new AutomationRequestError("automation_runtime_not_ready", 409);
  if (message.includes("emergency stop")) return new AutomationRequestError("automation_emergency_stopped", 409);
  if (message.includes("connected Postiz integration")) return new AutomationRequestError("postiz_connection_not_ready", 409);
  if (message.includes("channel mapping")) return new AutomationRequestError("postiz_channel_mapping_not_ready", 409);
  if (message.includes("indeterminate Postiz operation")) return new AutomationRequestError("indeterminate_postiz_operation", 409);
  if (message.includes("valid Postiz automation mode")) return new AutomationRequestError("automation_mode_invalid", 400);
  return error;
}

export function automationApiError(error: unknown) {
  return error instanceof AutomationRequestError ? error : null;
}

export async function updatePostizAutomationMode(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  let body: { mode?: unknown };
  try { body = await request.json() as typeof body; }
  catch { throw new AutomationRequestError("invalid_json", 400); }
  if (body.mode !== "manual" && body.mode !== "automatic" && body.mode !== "paused") {
    throw new AutomationRequestError("automation_mode_invalid", 400);
  }
  try {
    await database().query(
      "SELECT * FROM tanaghom.set_postiz_automation_mode($1::uuid, $2::text, $3::boolean)",
      [owner.id, body.mode, postizAutomationRuntimeReady()],
    );
  } catch (error) { throw mapAutomationDatabaseError(error); }
  return { automation: await getPostizAutomationStatus(owner.organizationId) };
}

export async function updateGhlActionAutomation(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  let body: { mode?: unknown; emergency_stop?: unknown; reason?: unknown };
  try { body = await request.json() as typeof body; }
  catch { throw new AutomationRequestError("invalid_json", 400); }
  if (typeof body.emergency_stop === "boolean") {
    if (body.mode !== undefined || typeof body.reason !== "string"
        || body.reason.trim().length < 3 || body.reason.trim().length > 500) {
      throw new AutomationRequestError("ghl_action_emergency_reason_invalid", 400);
    }
    try {
      await database().query(
        "SELECT tanaghom.set_ghl_action_emergency_stop($1::uuid,$2::boolean,$3::text,$4::boolean,$5::uuid)",
        [owner.id, body.emergency_stop, body.reason.trim(), ghlActionRuntimeReady(), randomUUID()],
      );
    } catch (error) { throw mapAutomationDatabaseError(error); }
    return { automation: await getGhlActionAutomationStatus(owner.organizationId) };
  }
  if (!new Set(["manual", "shadow", "assisted", "bounded_autonomous"]).has(String(body.mode))) {
    throw new AutomationRequestError("ghl_action_mode_invalid", 400);
  }
  try {
    await database().query(
      "SELECT tanaghom.set_ghl_action_automation_mode($1::uuid,$2::text,$3::boolean,$4::uuid)",
      [owner.id, body.mode, ghlActionRuntimeReady(), randomUUID()],
    );
  } catch (error) { throw mapAutomationDatabaseError(error); }
  return { automation: await getGhlActionAutomationStatus(owner.organizationId) };
}
