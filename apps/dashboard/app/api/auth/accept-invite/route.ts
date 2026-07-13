import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { AuthenticationError, authenticate, hasValidSameOrigin } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { apiFailure, noStore } from "@/lib/server/responses";
import { setSessionCookies } from "@/lib/server/session-cookies";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!hasValidSameOrigin(request)) throw new AuthenticationError("Same-origin request required");
    const identity = await authenticate(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return noStore({ error: "invalid_request" }, { status: 400 }); }
    const password = typeof body.password === "string" ? body.password : "";
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
