import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";

import type { ApplicationUser } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import {
  decryptCredential,
  encryptCredential,
  integrationEncryptionConfigured,
} from "@/lib/server/integration-crypto";
import { validateProviderBaseUrl } from "@/lib/server/integration-providers";
import {
  postizDatabase,
  postizDatabaseConfigured,
} from "@/lib/server/postiz-database";

export type PostizPlatform = "instagram" | "facebook" | "linkedin" | "tiktok" | "x";

export const SUPPORTED_PLATFORMS: ReadonlyArray<{ platform: PostizPlatform; postiz_integration: string }> = [
  { platform: "instagram", postiz_integration: "instagram" },
  { platform: "facebook", postiz_integration: "facebook" },
  { platform: "linkedin", postiz_integration: "linkedin-page" },
  { platform: "tiktok", postiz_integration: "tiktok" },
  { platform: "x", postiz_integration: "x" },
];

const PLATFORM_TO_INTEGRATION: Record<PostizPlatform, string> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin-page",
  tiktok: "tiktok",
  x: "x",
};

const IDENTIFIER_TO_PLATFORM: Record<string, PostizPlatform> = {
  instagram: "instagram",
  "instagram-standalone": "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  "linkedin-page": "linkedin",
  tiktok: "tiktok",
  x: "x",
  twitter: "x",
};

export interface PostizConnectionRow {
  id: string;
  organization_id: string;
  provider: "postiz";
  status: "configured" | "connected" | "error" | "disconnected";
  base_url: string;
  credential_ciphertext: Buffer | null;
  credential_nonce: Buffer | null;
  credential_auth_tag: Buffer | null;
  credential_key_version: number | null;
  secret_last_four: string | null;
  configuration: Record<string, unknown>;
}

export interface NormalizedPostizChannel {
  id: string;
  platform: PostizPlatform;
  identifier: string;
  name: string;
  profile: string;
  disabled: boolean;
}

export class PostizTenantError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
  }
}

type PostizQueryable = Pick<Pool, "query">;

export function postizBaseUrl() {
  const configured = process.env.POSTIZ_INTERNAL_BASE_URL?.trim()
    || process.env.POSTIZ_ALLOWED_BASE_URLS?.split(",")[0]?.trim()
    || "http://postiz:5000/api/public/v1";
  try {
    return validateProviderBaseUrl("postiz", configured);
  } catch {
    throw new PostizTenantError("postiz_base_url_not_configured", 503);
  }
}

export function postizWorkspaceConfigured() {
  try {
    postizBaseUrl();
    return postizDatabaseConfigured() && integrationEncryptionConfigured();
  } catch {
    return false;
  }
}

export function postizIntegrationFor(platform: PostizPlatform, variant?: unknown) {
  const base = PLATFORM_TO_INTEGRATION[platform];
  if (variant === undefined || variant === "") return base;
  if (platform === "instagram" && variant === "instagram-standalone") return "instagram-standalone";
  if (platform === "linkedin" && variant === "linkedin") return "linkedin";
  throw new PostizTenantError("channel_variant_invalid", 400);
}

export function platformForPostizIdentifier(identifier: string): PostizPlatform | null {
  return IDENTIFIER_TO_PLATFORM[identifier.trim().toLowerCase()] || null;
}

export function normalizePostizChannels(input: unknown): NormalizedPostizChannel[] {
  if (!Array.isArray(input)) return [];
  const result: NormalizedPostizChannel[] = [];
  for (const entry of input.slice(0, 250)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.identifier !== "string") continue;
    const platform = platformForPostizIdentifier(raw.identifier);
    if (!platform) continue;
    const identifier = raw.identifier.trim().slice(0, 80);
    result.push({
      id: raw.id.slice(0, 300),
      platform,
      identifier,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 160) : identifier,
      profile: typeof raw.profile === "string" ? raw.profile.slice(0, 160) : "",
      disabled: raw.disabled === true,
    });
  }
  return result;
}

function postizOrganizationId(row: PostizConnectionRow | undefined) {
  const value = row?.configuration?.postiz_organization_id;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function hasUsableCredential(row: PostizConnectionRow | undefined) {
  return Boolean(
    row
      && row.credential_ciphertext
      && row.credential_nonce
      && row.credential_auth_tag
      && row.credential_key_version,
  );
}

export function isActivePostizConnection(row: PostizConnectionRow | undefined): row is PostizConnectionRow {
  return Boolean(row?.status === "connected" && hasUsableCredential(row) && postizOrganizationId(row));
}

export async function findPostizConnection(organizationId: string) {
  const result = await database().query<PostizConnectionRow>(
    `SELECT * FROM tanaghom.integration_connections
      WHERE organization_id = $1 AND provider = 'postiz'`,
    [organizationId],
  );
  return result.rows[0];
}

export function decryptPostizConnectionKey(row: PostizConnectionRow) {
  if (!hasUsableCredential(row)) throw new PostizTenantError("postiz_workspace_not_provisioned", 409);
  return decryptCredential({
    credential_ciphertext: row.credential_ciphertext!,
    credential_nonce: row.credential_nonce!,
    credential_auth_tag: row.credential_auth_tag!,
    credential_key_version: row.credential_key_version!,
  });
}

async function auditProvisioned(
  client: Pick<import("pg").PoolClient, "query">,
  user: Pick<ApplicationUser, "id">,
  connectionId: string,
  postizOrganizationIdValue: string,
) {
  await client.query(
    `INSERT INTO tanaghom.agent_actions_log
       (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
     VALUES ($1, $2, 'integration.postiz_workspace_provisioned', 'integration_connection', $3, $4::jsonb, 'success')`,
    [randomUUID(), user.id, connectionId, JSON.stringify({
      provider: "postiz",
      postiz_organization_id: postizOrganizationIdValue,
    })],
  );
}

/**
 * Ensures exactly one Postiz organization exists for this Tanaghom tenant and
 * stores its authoritative 64-hex Public API key encrypted in Tanaghom.
 *
 * A Postiz row may already exist because a retry won the database race. In that
 * case the candidate key is discarded and the row's key is used; the candidate
 * must never be encrypted or returned.
 */
export async function ensurePostizTenantConnection(
  user: Pick<ApplicationUser, "id" | "organizationId">,
  options: { pool?: PostizQueryable; organizationName?: string } = {},
) {
  if (!integrationEncryptionConfigured()) {
    throw new PostizTenantError("credential_encryption_not_configured", 503);
  }
  const pool = options.pool || postizDatabase();
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `postiz-tenant:${user.organizationId}`,
    ]);
    const existing = await client.query<PostizConnectionRow>(
      `SELECT * FROM tanaghom.integration_connections
        WHERE organization_id = $1 AND provider = 'postiz'
        FOR UPDATE`,
      [user.organizationId],
    );
    const row = existing.rows[0];
    if (row?.status === "connected" && hasUsableCredential(row) && postizOrganizationId(row)) {
      await client.query("COMMIT");
      return { connection: row, newlyProvisioned: false };
    }

    const postizOrganizationIdValue = postizOrganizationId(row) || user.organizationId;
    const collision = await client.query<{ organization_id: string }>(
      `SELECT organization_id FROM tanaghom.integration_connections
        WHERE provider = 'postiz'
          AND organization_id <> $2
          AND configuration->>'postiz_organization_id' = $1
        LIMIT 1`,
      [postizOrganizationIdValue, user.organizationId],
    );
    if (collision.rowCount) {
      throw new PostizTenantError("postiz_workspace_already_linked", 409);
    }
    const baseUrl = row?.base_url || postizBaseUrl();
    const candidateKey = randomBytes(32).toString("hex");
    const inserted = await pool.query<{ id: string; apiKey: string | null }>(
      `INSERT INTO "Organization"
         (id, name, description, "apiKey", "createdAt", "updatedAt", "allowTrial", "isTrailing")
       VALUES ($1, $2, $3, $4, now(), now(), false, false)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, "apiKey"`,
      [
        postizOrganizationIdValue,
        `Tanaghom ${options.organizationName || user.organizationId.slice(0, 8)}`.slice(0, 120),
        `Tanaghom tenant ${user.organizationId}`,
        candidateKey,
      ],
    );

    let authoritativeKey = inserted.rows[0]?.apiKey || "";
    if (!authoritativeKey) {
      const current = await pool.query<{ apiKey: string | null }>(
        `SELECT "apiKey" FROM "Organization" WHERE id = $1`,
        [postizOrganizationIdValue],
      );
      authoritativeKey = current.rows[0]?.apiKey || "";
    }
    if (!/^[a-f0-9]{64}$/i.test(authoritativeKey)) {
      throw new PostizTenantError("postiz_workspace_key_invalid", 503);
    }

    const encrypted = encryptCredential(authoritativeKey);
    const configuration = {
      ...(row?.configuration || {}),
      postiz_organization_id: postizOrganizationIdValue,
    };
    const saved = await client.query<PostizConnectionRow>(
      `INSERT INTO tanaghom.integration_connections
         (organization_id, provider, status, base_url, credential_kind,
          credential_ciphertext, credential_nonce, credential_auth_tag,
          credential_key_version, secret_last_four, configuration, configured_by)
       VALUES ($1, 'postiz', 'connected', $2, 'api_key', $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (organization_id, provider) DO UPDATE SET
         status = 'connected',
         base_url = EXCLUDED.base_url,
         credential_kind = EXCLUDED.credential_kind,
         credential_ciphertext = EXCLUDED.credential_ciphertext,
         credential_nonce = EXCLUDED.credential_nonce,
         credential_auth_tag = EXCLUDED.credential_auth_tag,
         credential_key_version = EXCLUDED.credential_key_version,
         secret_last_four = EXCLUDED.secret_last_four,
         configuration = EXCLUDED.configuration,
         configured_by = EXCLUDED.configured_by,
         last_error_code = NULL,
         disconnected_at = NULL
       RETURNING *`,
      [
        user.organizationId,
        baseUrl,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.authTag,
        encrypted.keyVersion,
        encrypted.lastFour,
        JSON.stringify(configuration),
        user.id,
      ],
    );
    const connection = saved.rows[0];
    await auditProvisioned(client, user, connection.id, postizOrganizationIdValue);
    await client.query("COMMIT");
    return { connection, newlyProvisioned: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function postizResponse(response: Response) {
  const text = await response.text();
  if (text.length > 1_000_000) throw new PostizTenantError("postiz_response_too_large", 502);
  try {
    return text ? JSON.parse(text) as unknown : {};
  } catch {
    throw new PostizTenantError("postiz_response_invalid", 502);
  }
}

async function postizFetch(url: string, key: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: key, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new PostizTenantError("postiz_unreachable", 502);
  }
  return response;
}

export async function fetchPostizChannels(baseUrl: string, key: string) {
  const response = await postizFetch(`${baseUrl.replace(/\/+$/, "")}/integrations`, key);
  const body = await postizResponse(response);
  if (!response.ok) {
    throw new PostizTenantError(
      response.status === 401 || response.status === 403 ? "postiz_credential_rejected" : "postiz_channel_discovery_failed",
      response.status === 401 || response.status === 403 ? 409 : 502,
    );
  }
  if (!Array.isArray(body)) throw new PostizTenantError("postiz_channel_discovery_failed", 502);
  return normalizePostizChannels(body);
}

export async function getPostizOAuthUrl(
  baseUrl: string,
  key: string,
  integration: string,
) {
  const response = await postizFetch(
    `${baseUrl.replace(/\/+$/, "")}/social/${encodeURIComponent(integration)}`,
    key,
  );
  const body = await postizResponse(response);
  if (response.status === 500 || !response.ok) {
    throw new PostizTenantError("social_provider_not_configured", 409);
  }
  const rawUrl = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).url
    : undefined;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new PostizTenantError("social_provider_not_configured", 409);
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PostizTenantError("postiz_oauth_url_invalid", 502);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new PostizTenantError("postiz_oauth_url_invalid", 502);
  }
  for (const name of ["client_id", "client_key"]) {
    if (parsed.searchParams.has(name) && !parsed.searchParams.get(name)?.trim()) {
      throw new PostizTenantError("social_provider_not_configured", 409);
    }
  }
  return parsed.toString();
}

export async function recordChannelOAuthStarted(
  user: Pick<ApplicationUser, "id">,
  connectionId: string,
  platform: PostizPlatform,
  integration: string,
) {
  await database().query(
    `INSERT INTO tanaghom.agent_actions_log
       (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
     VALUES ($1, $2, 'integration.channel_oauth_started', 'integration_connection', $3, $4::jsonb, 'success')`,
    [randomUUID(), user.id, connectionId, JSON.stringify({
      provider: "postiz",
      platform,
      postiz_integration: integration,
    })],
  );
}

/**
 * Replaces the tenant's local draft mappings with the supported, enabled
 * channels currently returned by that tenant's own Postiz API key.
 */
export async function syncPublishingChannels(
  organizationId: string,
  channels: NormalizedPostizChannel[],
) {
  const mappings = new Map<string, string>();
  const seenPlatforms = new Set<PostizPlatform>();
  const active = channels.filter((channel) => {
    if (channel.disabled || seenPlatforms.has(channel.platform)) return false;
    seenPlatforms.add(channel.platform);
    return true;
  });
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM tanaghom.publishing_channels WHERE organization_id = $1 AND provider = 'postiz'",
      [organizationId],
    );
    for (const channel of active) {
      const settings = {
        __type: channel.identifier,
        ...(channel.platform === "instagram" ? { post_type: "post" } : {}),
      };
      await client.query(
        `INSERT INTO tanaghom.publishing_channels
           (organization_id, provider, channel, provider_integration_id, provider_settings)
         VALUES ($1, 'postiz', $2, $3, $4::jsonb)`,
        [organizationId, channel.platform, channel.id, JSON.stringify(settings)],
      );
      mappings.set(channel.id, channel.platform);
    }
    await client.query("COMMIT");
    return mappings;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
