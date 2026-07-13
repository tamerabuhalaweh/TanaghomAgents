import "server-only";

import type { NextRequest } from "next/server";

import { authenticate } from "@/lib/server/auth";
import { database } from "@/lib/server/database";

export type ApplicationRole = "owner" | "reviewer" | "operator" | "viewer";

export interface ApplicationUser {
  id: string;
  displayName: string;
  role: ApplicationRole;
}

export class AuthorizationError extends Error {}

export async function authorize(
  request: NextRequest,
  allowedRoles: readonly ApplicationRole[],
): Promise<ApplicationUser> {
  const identity = await authenticate(request);
  const result = await database().query<{
    id: string;
    display_name: string;
    role: ApplicationRole;
  }>(
    `SELECT id, display_name, role
       FROM tanaghom.app_users
      WHERE auth_subject = $1::uuid
        AND kind = 'human'
        AND is_active = true
        AND accepted_at IS NOT NULL`,
    [identity.sub],
  );

  const user = result.rows[0];
  if (!user || !allowedRoles.includes(user.role)) {
    throw new AuthorizationError("User is not authorized");
  }

  return { id: user.id, displayName: user.display_name, role: user.role };
}
