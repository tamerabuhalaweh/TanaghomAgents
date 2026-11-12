import "server-only";

import type { NextRequest } from "next/server";

import { AuthenticationError, authenticate } from "@/lib/server/auth";
import { database } from "@/lib/server/database";

export type ApplicationRole = "owner" | "reviewer" | "operator" | "viewer";

export interface ApplicationUser {
  id: string;
  authUserId: string;
  organizationId: string;
  displayName: string;
  role: ApplicationRole;
}

export interface TenantContext extends ApplicationUser {
  sessionId: string;
}

export class AuthorizationError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the tenant strictly from the authenticated session. The session row
 * must still be live in Postgres, and the caller must hold an active membership
 * for the organisation recorded on that row. No request parameter can change
 * the tenant.
 */
export async function authorize(
  request: NextRequest,
  allowedRoles: readonly ApplicationRole[],
): Promise<ApplicationUser> {
  const tenant = await requireTenant(request);
  if (!allowedRoles.includes(tenant.role)) {
    throw new AuthorizationError("User is not authorized");
  }
  return {
    id: tenant.id,
    authUserId: tenant.authUserId,
    organizationId: tenant.organizationId,
    displayName: tenant.displayName,
    role: tenant.role,
  };
}

export async function requireTenant(request: NextRequest): Promise<TenantContext> {
  const identity = await authenticate(request);
  const sessionId = typeof identity.session_id === "string" ? identity.session_id : "";
  const organizationId = typeof identity.organization_id === "string" ? identity.organization_id : "";
  if (!UUID_RE.test(sessionId) || !UUID_RE.test(organizationId)) {
    throw new AuthenticationError("Session is missing its tenant binding");
  }

  // Sliding idle window: a session that has not been refreshed for 30 minutes
  // stops authorizing requests, and an expired row revokes the cookie flow.
  const session = await database().query<{ id: string }>(
    `UPDATE tanaghom.sessions
        SET last_seen_at = now()
      WHERE id = $1::uuid
        AND user_id = $2::uuid
        AND organization_id = $3::uuid
        AND expires_at > now()
        AND last_seen_at > now() - interval '30 minutes'
      RETURNING id`,
    [sessionId, identity.sub, organizationId],
  );
  if (!session.rows[0]) {
    throw new AuthenticationError("Session expired");
  }

  const membership = await database().query<{
    id: string;
    organization_id: string;
    display_name: string;
    role: ApplicationRole;
  }>(
    `SELECT au.id, au.organization_id, au.display_name, au.role
       FROM tanaghom.app_users au
       JOIN tanaghom.memberships m
         ON m.user_id = au.auth_subject
        AND m.organization_id = au.organization_id
        AND m.is_active
       JOIN tanaghom.users u ON u.id = au.auth_subject AND u.disabled = false
      WHERE au.auth_subject = $1::uuid
        AND au.organization_id = $2::uuid
        AND au.kind = 'human'
        AND au.is_active = true
        AND au.accepted_at IS NOT NULL`,
    [identity.sub, organizationId],
  );

  const user = membership.rows[0];
  if (!user) throw new AuthorizationError("User is not authorized");

  return {
    id: user.id,
    authUserId: identity.sub,
    organizationId: user.organization_id,
    displayName: user.display_name,
    role: user.role,
    sessionId,
  };
}
