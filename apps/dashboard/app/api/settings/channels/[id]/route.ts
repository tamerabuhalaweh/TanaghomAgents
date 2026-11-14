import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import { postizDatabase } from "@/lib/server/postiz-database";
import {
  findPostizConnection,
  isActivePostizConnection,
  PostizTenantError,
  type PostizConnectionRow,
} from "@/lib/server/postiz-tenant";
import { apiFailure, noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

interface DeletedIntegration {
  id: string;
  providerIdentifier: string | null;
}

function channelIdFromRoute(value: string) {
  const id = value.trim();
  if (!id || id.length > 128 || id !== value || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

function failure(error: unknown) {
  if (error instanceof PostizTenantError) {
    return noStore({ error: error.code }, { status: error.status });
  }
  return apiFailure(error);
}

function postizOrganizationId(connection: PostizConnectionRow) {
  const value = connection.configuration?.postiz_organization_id;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Revokes one social channel's Postiz token and its local draft mapping. The
 * Postiz organization itself stays connected for every other channel.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    enforceSameOriginForCookieMutation(request);
    const user = await authorize(request, ["owner", "operator"]);
    const { id: rawId } = await context.params;
    const id = channelIdFromRoute(typeof rawId === "string" ? rawId : "");
    if (!id) return noStore({ error: "channel_id_invalid" }, { status: 400 });

    const connection = await findPostizConnection(user.organizationId);
    if (!isActivePostizConnection(connection)) {
      return noStore({ error: "postiz_not_connected" }, { status: 404 });
    }
    const postizOrganizationIdValue = postizOrganizationId(connection);
    if (!postizOrganizationIdValue) {
      return noStore({ error: "postiz_not_connected" }, { status: 404 });
    }

    // The token lives in Postiz, so remove it there first, scoped by both the
    // integration id and the caller's organization id. A foreign id matches
    // nothing and is indistinguishable from a missing id.
    const deletedIntegration = await postizDatabase().query<DeletedIntegration>(
      `DELETE FROM "Integration"
        WHERE id = $1 AND "organizationId" = $2
        RETURNING id, "providerIdentifier"`,
      [id, postizOrganizationIdValue],
    );
    const providerIdentifier = deletedIntegration.rows[0]?.providerIdentifier || null;

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const deletedMapping = await client.query<{ id: string }>(
        `DELETE FROM tanaghom.publishing_channels
          WHERE organization_id = $1::uuid AND provider = 'postiz' AND provider_integration_id = $2
          RETURNING id`,
        [user.organizationId, id],
      );
      if (deletedIntegration.rowCount === 0 && deletedMapping.rowCount === 0) {
        await client.query("ROLLBACK");
        return noStore({ error: "channel_not_found" }, { status: 404 });
      }

      const locked = await client.query<PostizConnectionRow>(
        `SELECT * FROM tanaghom.integration_connections
          WHERE organization_id = $1 AND provider = 'postiz'
          FOR UPDATE`,
        [user.organizationId],
      );
      const current = locked.rows[0];
      if (current) {
        const configuration = { ...(current.configuration || {}) };
        if (Array.isArray(configuration.discovered_channels)) {
          configuration.discovered_channels = configuration.discovered_channels
            .filter((entry) => !(entry && typeof entry === "object" && (entry as Record<string, unknown>).id === id));
          await client.query(
            `UPDATE tanaghom.integration_connections
                SET configuration = $2::jsonb
              WHERE id = $1 AND organization_id = $3`,
            [current.id, JSON.stringify(configuration), user.organizationId],
          );
        }
      }

      await client.query(
        `INSERT INTO tanaghom.agent_actions_log
           (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
         VALUES ($1, $2, 'integration.channel_disconnected', 'integration_connection', $3, $4::jsonb, 'success')`,
        [randomUUID(), user.id, connection.id, JSON.stringify({
          provider: "postiz",
          channel_id: id,
          provider_identifier: providerIdentifier,
          postiz_organization_id: postizOrganizationIdValue,
        })],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    return noStore({ ok: true, disconnected_id: id });
  } catch (error) {
    return failure(error);
  }
}
