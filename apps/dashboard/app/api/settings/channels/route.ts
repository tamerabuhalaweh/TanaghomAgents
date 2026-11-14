import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { IntegrationProviderError, validateProviderBaseUrl } from "@/lib/server/integration-providers";
import {
  decryptPostizConnectionKey,
  ensurePostizTenantConnection,
  fetchPostizChannels,
  findPostizConnection,
  isActivePostizConnection,
  postizWorkspaceConfigured,
  syncPublishingChannels,
  SUPPORTED_PLATFORMS,
  PostizTenantError,
} from "@/lib/server/postiz-tenant";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

const ALL_ROLES = ["owner", "operator", "reviewer", "viewer"] as const;

function failure(error: unknown) {
  if (error instanceof PostizTenantError) {
    return noStore({ error: error.code }, { status: error.status });
  }
  if (error instanceof IntegrationProviderError) {
    return noStore({ error: error.message }, { status: error.status });
  }
  return apiFailure(error);
}

async function tenantName(organizationId: string) {
  const result = await database().query<{ name: string }>(
    "SELECT name FROM tanaghom.organizations WHERE id = $1::uuid",
    [organizationId],
  );
  return result.rows[0]?.name || organizationId.slice(0, 8);
}

export async function GET(request: NextRequest) {
  try {
    const user = await authorize(request, ALL_ROLES);
    let connection = await findPostizConnection(user.organizationId);
    const ready = postizWorkspaceConfigured();
    const canProvision = ready && (user.role === "owner" || user.role === "operator");

    if (!isActivePostizConnection(connection) && canProvision) {
      const ensured = await ensurePostizTenantConnection(user, {
        organizationName: await tenantName(user.organizationId),
      });
      connection = ensured.connection;
    }

    if (!isActivePostizConnection(connection)) {
      return noStore({
        provisioning_ready: false,
        human_approval_required: true,
        supported_platforms: SUPPORTED_PLATFORMS,
        channels: [],
      });
    }

    const baseUrl = validateProviderBaseUrl("postiz", connection.base_url);
    const key = decryptPostizConnectionKey(connection);
    const channels = await fetchPostizChannels(baseUrl, key);
    const mappings = await syncPublishingChannels(user.organizationId, channels);

    return noStore({
      provisioning_ready: true,
      human_approval_required: true,
      supported_platforms: SUPPORTED_PLATFORMS,
      channels: channels.map((channel) => ({
        id: channel.id,
        platform: channel.platform,
        identifier: channel.identifier,
        name: channel.name,
        profile: channel.profile,
        disabled: channel.disabled,
        mapped_for_drafts: !channel.disabled && mappings.has(channel.id),
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    enforceSameOriginForCookieMutation(request);
    const user = await authorize(request, ["owner", "operator"]);
    const connection = await findPostizConnection(user.organizationId);
    if (!connection) return noStore({ error: "postiz_not_connected" }, { status: 404 });

    const retainedOrganizationId = typeof connection.configuration?.postiz_organization_id === "string"
      ? connection.configuration.postiz_organization_id
      : null;
    const configuration = retainedOrganizationId
      ? { postiz_organization_id: retainedOrganizationId }
      : {};
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE tanaghom.integration_connections
            SET status = 'disconnected',
                credential_ciphertext = NULL, credential_nonce = NULL,
                credential_auth_tag = NULL, credential_key_version = NULL,
                secret_last_four = NULL, configuration = $2::jsonb,
                last_tested_at = NULL, last_test_status = NULL,
                last_error_code = NULL, disconnected_at = statement_timestamp()
          WHERE id = $1 AND organization_id = $3`,
        [connection.id, JSON.stringify(configuration), user.organizationId],
      );
      await client.query(
        "DELETE FROM tanaghom.publishing_channels WHERE organization_id = $1 AND provider = 'postiz'",
        [user.organizationId],
      );
      await client.query(
        `INSERT INTO tanaghom.agent_actions_log
           (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
         VALUES ($1, $2, 'integration.postiz_disconnected', 'integration_connection', $3, $4::jsonb, 'success')`,
        [randomUUID(), user.id, connection.id, JSON.stringify({
          provider: "postiz",
          postiz_organization_id: retainedOrganizationId,
        })],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return noStore({ disconnected: true });
  } catch (error) {
    return failure(error);
  }
}
