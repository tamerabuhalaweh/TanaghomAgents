import type { NextRequest } from "next/server";

import { AuthorizationError } from "@/lib/server/authorization";
import { AuthenticationError, enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import {
  SuperAdminNotFound,
  requireSuperAdmin,
  setCircuitBreaker,
  superAdminSnapshot,
  updateLaunchConfiguration,
} from "@/lib/server/super-admin";
import { noStore } from "@/lib/server/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;

function failure(error: unknown) {
  if (error instanceof SuperAdminNotFound || error instanceof AuthenticationError || error instanceof AuthorizationError) {
    return noStore({ error: "not_found" }, { status: 404 });
  }
  console.error("Tanaghom super-admin request failed", error);
  return noStore({ error: "service_unavailable" }, { status: 503 });
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireSuperAdmin(request);
    return noStore(await superAdminSnapshot(actor));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOriginForCookieMutation(request);
    const actor = await requireSuperAdmin(request);
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return noStore({ error: "payload_too_large" }, { status: 413 });
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return noStore({ error: "invalid_request" }, { status: 400 });
    }
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "reset_ai_circuit_breaker") {
      const state = await setCircuitBreaker(actor, {
        enabled: true,
        emergencyStop: false,
        reason: "Operational",
      });
      return noStore({ ok: true, action, circuit_breaker: state });
    }
    if (action === "set_ai_circuit_breaker") {
      if (typeof body.emergency_stop !== "boolean") {
        return noStore({ error: "emergency_stop_required" }, { status: 400 });
      }
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      const state = await setCircuitBreaker(actor, {
        enabled: true,
        emergencyStop: body.emergency_stop,
        reason,
      });
      return noStore({ ok: true, action, circuit_breaker: state });
    }
    if (action === "update_launch_config") {
      const cohortCap = Number(body.cohort_cap);
      const cohortUnlimited = body.cohort_unlimited;
      const launch100Enabled = body.launch100_enabled;
      const launch100Max = body.launch100_max_redemptions === undefined
        ? undefined
        : Number(body.launch100_max_redemptions);
      if (!Number.isSafeInteger(cohortCap) || cohortCap < 1 || cohortCap > 100_000
        || typeof cohortUnlimited !== "boolean"
        || typeof launch100Enabled !== "boolean"
        || (launch100Max !== undefined && (!Number.isSafeInteger(launch100Max) || launch100Max < 1 || launch100Max > 1_000_000))) {
        return noStore({ error: "launch_config_invalid" }, { status: 400 });
      }
      const config = await updateLaunchConfiguration(actor, {
        cohortCap,
        cohortUnlimited,
        launch100Enabled,
        launch100MaxRedemptions: launch100Max,
      });
      return noStore({ ok: true, action, config });
    }
    return noStore({ error: "invalid_action" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
