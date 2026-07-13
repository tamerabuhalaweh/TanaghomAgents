import "server-only";

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize, type ApplicationRole } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { inviteAuthUser, removeAuthUser, SupabaseAdminError } from "@/lib/server/supabase-admin";

const manageableRoles = new Set<ApplicationRole>(["owner", "reviewer", "operator", "viewer"]);

export class TeamRequestError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function stringValue(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicOrigin(request: NextRequest) {
  const configured = process.env.APP_BASE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const host = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim()
    || request.headers.get("host")
    || request.nextUrl.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim()
    || request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function inviteTeamMember(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { throw new TeamRequestError("invalid_json", 400); }

  const email = stringValue(body.email, 254).toLowerCase();
  const displayName = stringValue(body.display_name, 100);
  const role = body.role as ApplicationRole;
  if (!validEmail(email) || displayName.length < 2 || !manageableRoles.has(role)) {
    throw new TeamRequestError("invalid_invitation", 400);
  }

  const duplicate = await database().query(
    `SELECT 1 FROM tanaghom.app_users WHERE organization_id = $1 AND lower(email) = $2`,
    [owner.organizationId, email],
  );
  if (duplicate.rows[0]) throw new TeamRequestError("email_already_added", 409);

  const authUser = await inviteAuthUser({
    email,
    displayName,
    redirectTo: `${publicOrigin(request)}/accept-invite`,
  });
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const created = await client.query<{ id: string }>(
      `INSERT INTO tanaghom.app_users
        (email, display_name, kind, role, is_active, auth_subject, invited_by, invited_at, organization_id)
       VALUES ($1, $2, 'human', $3, true, $4, $5, now(), $6)
       RETURNING id`,
      [email, displayName, role, authUser.id, owner.id, owner.organizationId],
    );
    await client.query(
      `INSERT INTO tanaghom.agent_actions_log
        (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
       VALUES ($1, $2, 'team.user_invited', 'app_user', $3, $4::jsonb, 'success')`,
      [randomUUID(), owner.id, created.rows[0].id, JSON.stringify({ email, role })],
    );
    await client.query("COMMIT");
    return { ok: true, user_id: created.rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK");
    await removeAuthUser(authUser.id);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTeamMember(request: NextRequest, userId: string) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new TeamRequestError("invalid_user_id", 400);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { throw new TeamRequestError("invalid_json", 400); }
  const role = body.role as ApplicationRole;
  const isActive = body.is_active;
  if (!manageableRoles.has(role) || typeof isActive !== "boolean") {
    throw new TeamRequestError("invalid_membership_update", 400);
  }
  if (userId === owner.id && (role !== "owner" || !isActive)) {
    throw new TeamRequestError("cannot_change_own_owner_access", 409);
  }

  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ role: ApplicationRole; is_active: boolean }>(
      `SELECT role, is_active FROM tanaghom.app_users
        WHERE id = $1 AND organization_id = $2 AND kind = 'human' FOR UPDATE`,
      [userId, owner.organizationId],
    );
    if (!existing.rows[0]) throw new TeamRequestError("user_not_found", 404);
    if (existing.rows[0].role === "owner" && existing.rows[0].is_active && (role !== "owner" || !isActive)) {
      const owners = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tanaghom.app_users
          WHERE organization_id = $1 AND kind = 'human' AND role = 'owner' AND is_active = true`,
        [owner.organizationId],
      );
      if (owners.rows[0].count <= 1) throw new TeamRequestError("last_owner_protected", 409);
    }
    await client.query(
      `UPDATE tanaghom.app_users SET role = $2, is_active = $3
        WHERE id = $1 AND organization_id = $4`,
      [userId, role, isActive, owner.organizationId],
    );
    await client.query(
      `INSERT INTO tanaghom.agent_actions_log
        (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
       VALUES ($1, $2, 'team.user_updated', 'app_user', $3, $4::jsonb, 'success')`,
      [randomUUID(), owner.id, userId, JSON.stringify({ role, is_active: isActive })],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function teamApiError(error: unknown) {
  if (error instanceof TeamRequestError || error instanceof SupabaseAdminError) {
    return { code: error.code, status: error.status };
  }
  return null;
}
