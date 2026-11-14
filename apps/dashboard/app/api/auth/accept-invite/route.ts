import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { AuthenticationError, authenticate, hasValidSameOrigin } from "@/lib/server/auth";
import { authUpstreamPayload, postAuthEmail, retryAfterSeconds } from "@/lib/server/auth-email";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import { setSessionCookies } from "@/lib/server/session-cookies";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!hasValidSameOrigin(request)) throw new AuthenticationError("Same-origin request required");
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return noStore({ error: "invalid_request" }, { status: 400 }); }
    const password = typeof body.password === "string" ? body.password : "";
    const inviteToken = typeof body.token === "string" ? body.token : "";

    // WS6 invitation links carry a single-use token. Accept it publicly; the
    // auth service validates, consumes, marks the email verified, and updates
    // the profile acceptance in one transaction.
    if (inviteToken) {
      if (!password || password.length > 512) {
        return noStore({ error: "password_requirements_not_met" }, { status: 400 });
      }
      let upstream: Response | null;
      try {
        upstream = await postAuthEmail(request, "/auth/v1/accept-invite", {
          token: inviteToken,
          password,
          display_name: typeof body.display_name === "string" ? body.display_name : undefined,
        });
      } catch {
        return noStore({ error: "authentication_unavailable" }, { status: 503 });
      }
      if (!upstream) return noStore({ error: "authentication_not_configured" }, { status: 503 });
      const payload = await authUpstreamPayload(upstream);
      if (upstream.ok) return noStore(payload);
      if (upstream.status === 429) {
        const retryAfter = retryAfterSeconds(upstream);
        return noStore(
          { error: "too_many_attempts", retry_after: retryAfter },
          { status: 429, headers: retryAfter > 0 ? { "Retry-After": String(retryAfter) } : undefined },
        );
      }
      if (upstream.status === 400) {
        return noStore({ error: payload.error ?? "invalid_or_expired_token" }, { status: 400 });
      }
      return noStore({ error: "invite_session_invalid" }, { status: 401 });
    }

    // Legacy Supabase-style invitation sessions have no token; keep the
    // authenticated setup path until those emails have expired.
    const identity = await authenticate(request);
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (password.length < 12 || password.length > 128 || !refreshToken) {
      return noStore({ error: "password_requirements_not_met" }, { status: 400 });
    }

    const member = await database().query<{ id: string }>(
      `SELECT id FROM tanaghom.app_users
        WHERE auth_subject = $1::uuid AND kind = 'human' AND is_active = true`,
      [identity.sub],
    );
    if (!member.rows[0]) return noStore({ error: "invitation_not_authorized" }, { status: 403 });

    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !publishableKey) return noStore({ error: "authentication_not_configured" }, { status: 503 });
    let upstream: Response;
    try {
      upstream = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: publishableKey,
          Authorization: request.headers.get("authorization") || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      return noStore({ error: "authentication_unavailable" }, { status: 503 });
    }
    if (!upstream.ok) return noStore({ error: "invite_session_invalid" }, { status: 401 });

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const accepted = await client.query(
        `UPDATE tanaghom.app_users SET accepted_at = coalesce(accepted_at, now())
          WHERE id = $1 AND accepted_at IS NULL RETURNING id`, [member.rows[0].id],
      );
      if (accepted.rows[0]) {
        await client.query(
          `INSERT INTO tanaghom.agent_actions_log
            (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
           VALUES ($1, $2, 'team.invitation_accepted', 'app_user', $2, '{}'::jsonb, 'success')`,
          [randomUUID(), member.rows[0].id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
    const response = noStore({ ok: true });
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const expiresIn = identity.exp ? Math.max(60, identity.exp - Math.floor(Date.now() / 1000)) : 3600;
    setSessionCookies(response, { access_token: token, refresh_token: refreshToken, expires_in: expiresIn });
    return response;
  } catch (error) { return apiFailure(error); }
}
