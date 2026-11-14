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

  // Access tokens minted before WS2 carry no session/tenant claims. They are
  // valid for at most the 15-minute access lifetime, so resolve their tenant
  // from the profile row once instead of locking live users out mid-session.
  // Every token issued from now on takes the strict path below.
  if (!sessionId && !organizationId) {
    const profile = await database().query<{
      id: string;
      organization_id: string;
      display_name: string;
      role: ApplicationRole;
    }>(
      `SELECT id, organization_id, display_name, role
         FROM tanaghom.app_users
        WHERE auth_subject = $1::uuid
          AND kind = 'human'
          AND is_active = true
          AND accepted_at IS NOT NULL`,
      [identity.sub],
    );
    const legacyUser = profile.rows[0];
    if (!legacyUser) throw new AuthorizationError("User is not authorized");
    return {
      id: legacyUser.id,
      authUserId: identity.sub,
      organizationId: legacyUser.organization_id,
      displayName: legacyUser.display_name,
      role: legacyUser.role,
      sessionId: "",
    };
  }

  if (!UUID_RE.test(sessionId) || !UUID_RE.test(organizationId)) {
    throw new AuthenticationError("Session is missing its tenant binding");
  }

  // One round trip proves the live session, checks the complete membership and
  // user state, and touches last_seen_at only when it is at least 60 seconds old.
  // A deactivated membership or disabled user still returns the valid_session
  // row, with a null profile, so it maps to 403 rather than a false 401.
  const session = await database().query<{
    session_id: string;
    id: string | null;
    organization_id: string | null;
    display_name: string | null;
    role: ApplicationRole | null;
  }>(
    `WITH valid_session AS (
       SELECT s.id, s.last_seen_at
         FROM tanaghom.sessions s
        WHERE s.id = $1::uuid
          AND s.user_id = $2::uuid
          AND s.organization_id = $3::uuid
          AND s.expires_at > now()
          AND s.last_seen_at > now() - interval '30 minutes'
     ),
     touched_session AS (
       UPDATE tanaghom.sessions
          SET last_seen_at = now()
        WHERE id = (SELECT id FROM valid_session WHERE last_seen_at <= now() - interval '60 seconds')
        RETURNING id
     ),
     authorized_member AS (
       SELECT au.id, au.organization_id, au.display_name, au.role
         FROM tanaghom.app_users au
         JOIN tanaghom.memberships m
           ON m.user_id = au.auth_subject
          AND m.organization_id = au.organization_id
          AND m.is_active
         JOIN tanaghom.users u
           ON u.id = au.auth_subject
          AND u.disabled = false
        WHERE au.auth_subject = $2::uuid
          AND au.organization_id = $3::uuid
          AND au.kind = 'human'
          AND au.is_active = true
          AND au.accepted_at IS NOT NULL
     )
     SELECT vs.id AS session_id, am.id, am.organization_id, am.display_name, am.role
       FROM valid_session vs
       LEFT JOIN authorized_member am ON true`,
    [sessionId, identity.sub, organizationId],
  );

  if (session.rows.length === 0) {
    throw new AuthenticationError("Session expired");
  }
  const user = session.rows[0];
  if (!user.id || !user.organization_id || !user.display_name || !user.role) {
    throw new AuthorizationError("User is not authorized");
  }

  return {
    id: user.id,
    authUserId: identity.sub,
    organizationId: user.organization_id,
    displayName: user.display_name,
    role: user.role,
    sessionId: user.session_id,
  };
}
