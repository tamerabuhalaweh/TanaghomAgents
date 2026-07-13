import "server-only";

interface InvitedAuthUser {
  id: string;
  email?: string;
}

export class SupabaseAdminError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new SupabaseAdminError("invitations_not_configured", 503);
  return { url, secretKey };
}

export async function inviteAuthUser(input: {
  email: string;
  displayName: string;
  redirectTo: string;
}) {
  const { url, secretKey } = configuration();
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/invite?redirect_to=${encodeURIComponent(input.redirectTo)}`, {
      method: "POST",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        data: { display_name: input.displayName, application: "tanaghom" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SupabaseAdminError("invitation_service_unavailable", 503);
  }
  if (!response.ok) {
    const duplicate = response.status === 422 || response.status === 409;
    throw new SupabaseAdminError(duplicate ? "auth_user_already_exists" : "invitation_failed", duplicate ? 409 : 502);
  }
  const payload = await response.json() as InvitedAuthUser | { user?: InvitedAuthUser };
  const user: InvitedAuthUser | undefined = "user" in payload
    ? payload.user
    : payload as InvitedAuthUser;
  if (!user?.id || !/^[0-9a-f-]{36}$/i.test(user.id)) {
    throw new SupabaseAdminError("invalid_invitation_response", 502);
  }
  return user;
}

export async function removeAuthUser(userId: string) {
  const { url, secretKey } = configuration();
  try {
    await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Compensation is best effort; the original failure remains authoritative.
  }
}
