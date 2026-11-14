import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { IntegrationProviderError, validateProviderBaseUrl } from "@/lib/server/integration-providers";
import {
  decryptPostizConnectionKey,
  ensurePostizTenantConnection,
  getPostizOAuthUrl,
  postizIntegrationFor,
  postizWorkspaceConfigured,
  recordChannelOAuthStarted,
  PostizTenantError,
  type PostizPlatform,
} from "@/lib/server/postiz-tenant";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

const PLATFORMS = new Set<PostizPlatform>(["instagram", "facebook", "linkedin", "tiktok", "x"]);

async function tenantName(organizationId: string) {
  const result = await database().query<{ name: string }>(
    "SELECT name FROM tanaghom.organizations WHERE id = $1::uuid",
    [organizationId],
  );
  return result.rows[0]?.name || organizationId.slice(0, 8);
}

function failure(error: unknown, platform?: PostizPlatform) {
  if (error instanceof PostizTenantError) {
    return noStore(
      { error: error.code, ...(platform ? { platform } : {}) },
      { status: error.status },
    );
  }
  if (error instanceof IntegrationProviderError) {
    return noStore({ error: error.message, ...(platform ? { platform } : {}) }, { status: error.status });
  }
  return apiFailure(error);
}

export async function POST(request: NextRequest) {
  let platform: PostizPlatform | undefined;
  try {
    enforceSameOriginForCookieMutation(request);
    const user = await authorize(request, ["owner", "operator"]);
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return noStore({ error: "invalid_request" }, { status: 400 });
    }
    if (typeof body.platform !== "string" || !PLATFORMS.has(body.platform as PostizPlatform)) {
      return noStore({ error: "channel_platform_invalid" }, { status: 400 });
    }
    platform = body.platform as PostizPlatform;
    if (!postizWorkspaceConfigured()) {
      return noStore({ error: "postiz_workspace_not_configured" }, { status: 503 });
    }

    const integration = postizIntegrationFor(platform, body.variant);
    const ensured = await ensurePostizTenantConnection(user, {
      organizationName: await tenantName(user.organizationId),
    });
    const baseUrl = validateProviderBaseUrl("postiz", ensured.connection.base_url);
    const key = decryptPostizConnectionKey(ensured.connection);
    const url = await getPostizOAuthUrl(baseUrl, key, integration);
    await recordChannelOAuthStarted(user, ensured.connection.id, platform, integration);
    return noStore({ url });
  } catch (error) {
    return failure(error, platform);
  }
}
