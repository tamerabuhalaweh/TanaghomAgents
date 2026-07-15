import "server-only";

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { getGhlActionAutomationStatus, getPostizAutomationStatus } from "@/lib/server/automation-management";
import { authorize, type ApplicationUser } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import {
  decryptCredential,
  encryptCredential,
  IntegrationCryptoError,
  integrationEncryptionConfigured,
} from "@/lib/server/integration-crypto";
import {
  IntegrationProviderError,
  parseProvider,
  providerDefinition,
  testProviderConnection,
  validateProviderBaseUrl,
  type DiscoveredPostizChannel,
  type IntegrationProvider,
} from "@/lib/server/integration-providers";

interface ConnectionRow {
  id: string;
  organization_id: string;
  provider: IntegrationProvider;
  status: "configured" | "connected" | "error" | "disconnected";
  base_url: string;
  credential_kind: "api_key" | "private_token" | "oauth";
  credential_ciphertext: Buffer | null;
  credential_nonce: Buffer | null;
  credential_auth_tag: Buffer | null;
  credential_key_version: number | null;
  secret_last_four: string | null;
  configuration: Record<string, unknown>;
  last_tested_at: string | null;
  last_test_status: "passed" | "failed" | null;
  last_error_code: string | null;
  updated_at: string;
}

export class IntegrationRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function safeConfiguration(provider: IntegrationProvider, input: unknown) {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (provider === "postiz") return {};
  const locationId = typeof value.location_id === "string" ? value.location_id.trim() : "";
  const pipelineId = typeof value.pipeline_id === "string" ? value.pipeline_id.trim() : "";
  const bookingLink = typeof value.booking_link === "string" ? value.booking_link.trim() : "";
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(locationId)) throw new IntegrationRequestError("ghl_location_id_required");
  if (pipelineId && !/^[A-Za-z0-9_-]{3,100}$/.test(pipelineId)) throw new IntegrationRequestError("ghl_pipeline_id_invalid");
  if (bookingLink) {
    let parsed: URL;
    try { parsed = new URL(bookingLink); } catch { throw new IntegrationRequestError("ghl_booking_link_invalid"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new IntegrationRequestError("ghl_booking_link_invalid");
  }
  return {
    location_id: locationId,
    ...(pipelineId ? { pipeline_id: pipelineId } : {}),
    ...(bookingLink ? { booking_link: bookingLink } : {}),
  };
}

function publicConnection(row: ConnectionRow | undefined) {
  if (!row) return null;
  const { account_label, discovered_channels, ...configuration } = row.configuration || {};
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    base_url: row.base_url,
    credential_kind: row.credential_kind,
    credential_mask: row.secret_last_four ? `••••••••${row.secret_last_four}` : null,
    configuration,
    account_label: typeof account_label === "string" ? account_label : null,
    discovered_channels: Array.isArray(discovered_channels) ? discovered_channels : [],
    last_tested_at: row.last_tested_at,
    last_test_status: row.last_test_status,
    last_error_code: row.last_error_code,
    updated_at: row.updated_at,
  };
}

async function audit(
  client: PoolClient,
  user: ApplicationUser,
  connectionId: string,
  action: string,
  provider: IntegrationProvider,
  result: "success" | "failed" = "success",
  details: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO tanaghom.agent_actions_log
      (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
     VALUES ($1, $2, $3, 'integration_connection', $4, $5::jsonb, $6)`,
    [randomUUID(), user.id, action, connectionId, JSON.stringify({ provider, ...details }), result],
  );
}

async function findConnection(client: PoolClient, organizationId: string, provider: IntegrationProvider, lock = false) {
  const result = await client.query<ConnectionRow>(
    `SELECT * FROM tanaghom.integration_connections
      WHERE organization_id = $1 AND provider = $2${lock ? " FOR UPDATE" : ""}`,
    [organizationId, provider],
  );
  return result.rows[0];
}

function knownError(error: unknown) {
  if (error instanceof IntegrationRequestError || error instanceof IntegrationProviderError) return error;
  if (error instanceof IntegrationCryptoError) return new IntegrationRequestError(error.message, 503);
  return null;
}

export function integrationApiError(error: unknown) { return knownError(error); }

export async function listIntegrations(request: NextRequest) {
  const owner = await authorize(request, ["owner"]);
  const [result, mappings, automation, ghlActionAutomation] = await Promise.all([database().query<ConnectionRow>(
    `SELECT * FROM tanaghom.integration_connections
      WHERE organization_id = $1 ORDER BY provider`,
    [owner.organizationId],
  ), database().query(
    `SELECT channel, provider_integration_id, provider_settings, is_active
       FROM tanaghom.publishing_channels
      WHERE organization_id = $1 AND provider = 'postiz'
      ORDER BY channel`,
    [owner.organizationId],
  ), getPostizAutomationStatus(owner.organizationId), getGhlActionAutomationStatus(owner.organizationId)]);
  const byProvider = new Map(result.rows.map((row) => [row.provider, publicConnection(row)]));
  return {
    secure_storage_configured: integrationEncryptionConfigured(),
    providers: (["postiz", "ghl"] as const).map((provider) => ({
      provider,
      label: providerDefinition(provider).label,
      default_base_url: providerDefinition(provider).defaultBaseUrl,
      connection: byProvider.get(provider) || null,
    })),
    postiz_mappings: mappings.rows,
    postiz_automation: automation,
    ghl_action_automation: ghlActionAutomation,
  };
}

export async function saveIntegration(request: NextRequest, rawProvider: string) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  const provider = parseProvider(rawProvider);
  const body = await request.json() as Record<string, unknown>;
  const secret = typeof body.secret === "string" ? body.secret : "";
  const baseUrl = validateProviderBaseUrl(provider, typeof body.base_url === "string" ? body.base_url : undefined);
  const configuration = safeConfiguration(provider, body.configuration);
  const encrypted = encryptCredential(secret);
  const definition = providerDefinition(provider);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<ConnectionRow>(
      `INSERT INTO tanaghom.integration_connections
        (organization_id, provider, status, base_url, credential_kind,
         credential_ciphertext, credential_nonce, credential_auth_tag,
         credential_key_version, secret_last_four, configuration, configured_by)
       VALUES ($1, $2, 'configured', $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       ON CONFLICT (organization_id, provider) DO UPDATE SET
         status = 'configured', base_url = EXCLUDED.base_url,
         credential_kind = EXCLUDED.credential_kind,
         credential_ciphertext = EXCLUDED.credential_ciphertext,
         credential_nonce = EXCLUDED.credential_nonce,
         credential_auth_tag = EXCLUDED.credential_auth_tag,
         credential_key_version = EXCLUDED.credential_key_version,
         secret_last_four = EXCLUDED.secret_last_four,
         configuration = EXCLUDED.configuration,
         configured_by = EXCLUDED.configured_by,
         last_tested_at = NULL, last_test_status = NULL, last_error_code = NULL,
         disconnected_at = NULL
       RETURNING *`,
      [owner.organizationId, provider, baseUrl, definition.credentialKind,
       encrypted.ciphertext, encrypted.nonce, encrypted.authTag, encrypted.keyVersion,
       encrypted.lastFour, JSON.stringify(configuration), owner.id],
    );
    await audit(client, owner, result.rows[0].id, "integration.credential_saved", provider, "success", {
      credential_kind: definition.credentialKind,
      key_version: encrypted.keyVersion,
    });
    await client.query("COMMIT");
    return { connection: publicConnection(result.rows[0]) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function testIntegration(request: NextRequest, rawProvider: string) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  const provider = parseProvider(rawProvider);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const row = await findConnection(client, owner.organizationId, provider, true);
    if (!row || row.status === "disconnected" || !row.credential_ciphertext || !row.credential_nonce || !row.credential_auth_tag || !row.credential_key_version) {
      throw new IntegrationRequestError("integration_not_configured", 409);
    }
    const secret = decryptCredential({
      credential_ciphertext: row.credential_ciphertext,
      credential_nonce: row.credential_nonce,
      credential_auth_tag: row.credential_auth_tag,
      credential_key_version: row.credential_key_version,
    });
    try {
      const tested = await testProviderConnection(provider, row.base_url, secret, row.configuration);
      const configuration = {
        ...row.configuration,
        account_label: tested.accountLabel,
        ...(provider === "postiz" ? { discovered_channels: tested.channels || [] } : {}),
      };
      const updated = await client.query<ConnectionRow>(
        `UPDATE tanaghom.integration_connections
            SET status = 'connected', configuration = $3::jsonb,
                last_tested_at = statement_timestamp(), last_test_status = 'passed', last_error_code = NULL
          WHERE organization_id = $1 AND provider = $2 RETURNING *`,
        [owner.organizationId, provider, JSON.stringify(configuration)],
      );
      await audit(client, owner, row.id, "integration.connection_tested", provider, "success", {
        channel_count: tested.channels?.length || 0,
      });
      await client.query("COMMIT");
      return { connection: publicConnection(updated.rows[0]) };
    } catch (error) {
      const known = knownError(error) || new IntegrationRequestError("integration_test_failed", 502);
      await client.query(
        `UPDATE tanaghom.integration_connections
            SET status = 'error', last_tested_at = statement_timestamp(),
                last_test_status = 'failed', last_error_code = $3
          WHERE organization_id = $1 AND provider = $2`,
        [owner.organizationId, provider, known.message],
      );
      await audit(client, owner, row.id, "integration.connection_tested", provider, "failed", { error_code: known.message });
      await client.query("COMMIT");
      throw known;
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

const postizChannelMap: Record<string, string> = {
  instagram: "instagram", "instagram-standalone": "instagram", facebook: "facebook",
  linkedin: "linkedin", "linkedin-page": "linkedin", tiktok: "tiktok", youtube: "youtube",
};

export async function savePostizMappings(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  const body = await request.json() as { mappings?: unknown };
  if (!Array.isArray(body.mappings) || body.mappings.length > 12) throw new IntegrationRequestError("postiz_mappings_invalid");
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const connection = await findConnection(client, owner.organizationId, "postiz", true);
    if (!connection || connection.status !== "connected") throw new IntegrationRequestError("postiz_not_connected", 409);
    const discovered = Array.isArray(connection.configuration.discovered_channels)
      ? connection.configuration.discovered_channels as DiscoveredPostizChannel[] : [];
    const discoveredById = new Map(discovered.map((channel) => [channel.id, channel]));
    const mappings = body.mappings.map((raw) => {
      if (!raw || typeof raw !== "object") throw new IntegrationRequestError("postiz_mappings_invalid");
      const value = raw as Record<string, unknown>;
      const channel = typeof value.channel === "string" ? value.channel : "";
      const integrationId = typeof value.provider_integration_id === "string" ? value.provider_integration_id : "";
      const discoveredChannel = discoveredById.get(integrationId);
      if (!discoveredChannel || discoveredChannel.disabled || postizChannelMap[discoveredChannel.identifier] !== channel) {
        throw new IntegrationRequestError("postiz_mapping_not_discovered");
      }
      return { channel, integrationId, settings: { __type: discoveredChannel.identifier, ...(channel === "instagram" ? { post_type: "post" } : {}) } };
    });
    if (new Set(mappings.map((mapping) => mapping.channel)).size !== mappings.length) throw new IntegrationRequestError("postiz_mapping_duplicate_channel");
    await client.query(`DELETE FROM tanaghom.publishing_channels WHERE organization_id = $1 AND provider = 'postiz'`, [owner.organizationId]);
    for (const mapping of mappings) {
      await client.query(
        `INSERT INTO tanaghom.publishing_channels
          (organization_id, provider, channel, provider_integration_id, provider_settings)
         VALUES ($1, 'postiz', $2, $3, $4::jsonb)`,
        [owner.organizationId, mapping.channel, mapping.integrationId, JSON.stringify(mapping.settings)],
      );
    }
    await audit(client, owner, connection.id, "integration.channel_mappings_saved", "postiz", "success", { mapping_count: mappings.length });
    await client.query("COMMIT");
    return { mappings };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function disconnectIntegration(request: NextRequest, rawProvider: string) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  const provider = parseProvider(rawProvider);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const row = await findConnection(client, owner.organizationId, provider, true);
    if (!row) throw new IntegrationRequestError("integration_not_configured", 404);
    await client.query(
      `UPDATE tanaghom.integration_connections SET
         status = 'disconnected', credential_ciphertext = NULL, credential_nonce = NULL,
         credential_auth_tag = NULL, credential_key_version = NULL, secret_last_four = NULL,
         configuration = '{}'::jsonb, last_tested_at = NULL, last_test_status = NULL,
         last_error_code = NULL, disconnected_at = statement_timestamp()
       WHERE id = $1`,
      [row.id],
    );
    if (provider === "postiz") {
      await client.query(`DELETE FROM tanaghom.publishing_channels WHERE organization_id = $1 AND provider = 'postiz'`, [owner.organizationId]);
    }
    await audit(client, owner, row.id, "integration.disconnected", provider);
    await client.query("COMMIT");
    return { disconnected: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
