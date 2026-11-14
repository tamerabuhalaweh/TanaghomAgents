import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";

import { hashPassword, MIN_PASSWORD_LENGTH, passwordPolicyError } from "./passwords.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ABSOLUTE_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;

export class StoreError extends Error {}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function slugify(name) {
  const base = String(name)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `workspace-${randomUUID().slice(0, 8)}`;
}

function mapRow(row) {
  if (!row) return null;
  return {
    email: row.email,
    sub: row.id,
    displayName: row.full_name,
    passwordHash: row.password_hash,
    disabled: row.disabled,
    mustChangePassword: row.must_change_password,
    sessionEpoch: row.session_epoch,
    passwordChangedAt: row.password_changed_at ? row.password_changed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    organizationId: row.organization_id ?? null,
    organizationName: row.organization_name ?? null,
    role: row.role ?? null,
    locale: row.locale,
  };
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = process.env.AUTH_DATABASE_URL_FILE;
  if (file && existsSync(file)) return readFileSync(file, "utf8").trim();
  throw new StoreError("auth database is not configured");
}

export function createUserStore({ legacyFile, seedFile } = {}) {
  const pool = new Pool({
    connectionString: databaseUrl(),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "tanaghom-auth",
  });

  async function withClient(run) {
    const client = await pool.connect();
    try {
      return await run(client);
    } finally {
      client.release();
    }
  }

  async function readUser(where, values) {
    const result = await pool.query(
      `SELECT u.*, m.organization_id, o.name AS organization_name, m.role
         FROM tanaghom.users u
         LEFT JOIN LATERAL (
           SELECT membership.organization_id, membership.role
             FROM tanaghom.memberships membership
            WHERE membership.user_id = u.id AND membership.is_active
            ORDER BY (membership.role = 'owner') DESC, membership.created_at
            LIMIT 1
         ) m ON true
         LEFT JOIN tanaghom.organizations o ON o.id = m.organization_id
        WHERE ${where}`,
      values,
    );
    return mapRow(result.rows[0]);
  }

  // Move the pre-WS2 JSON accounts (scrypt hashes or the plaintext seed) into
  // Postgres exactly once, preserving ids so app_users.auth_subject keeps
  // pointing at the same subject.
  async function importLegacyIfEmpty() {
    // Idempotent on every start: import any JSON account that Postgres does not
    // have yet, without touching accounts created through signup.
    const file = legacyFile && existsSync(legacyFile) ? legacyFile : seedFile;
    if (!file || !existsSync(file)) return;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || !Array.isArray(parsed.users) || parsed.users.length === 0) return;

    const users = [];
    for (const item of parsed.users) {
      if (!item || typeof item.email !== "string" || typeof item.sub !== "string" || !UUID_RE.test(item.sub)) continue;
      const passwordHash = typeof item.passwordHash === "string" && item.passwordHash.startsWith("scrypt$")
        ? item.passwordHash
        : typeof item.password === "string" && item.password.length >= MIN_PASSWORD_LENGTH
          ? await hashPassword(item.password)
          : null;
      if (!passwordHash) continue;
      users.push({
        id: item.sub.toLowerCase(),
        email: normalizeEmail(item.email),
        passwordHash,
        displayName: (item.displayName ?? item.display_name ?? item.email.split("@")[0]).slice(0, 120),
        disabled: item.disabled === true,
        mustChangePassword: item.mustChangePassword === true || item.must_change_password === true,
        sessionEpoch: Number.isInteger(item.sessionEpoch) ? item.sessionEpoch : 0,
        passwordChangedAt: item.passwordChangedAt ?? null,
      });
    }
    if (users.length === 0) return;

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        for (const user of users) {
          await client.query(
            `INSERT INTO tanaghom.users
               (id, email, password_hash, full_name, disabled, must_change_password,
                session_epoch, password_changed_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), now())
             ON CONFLICT (email) DO NOTHING`,
            [user.id, user.email, user.passwordHash, user.displayName, user.disabled,
              user.mustChangePassword, user.sessionEpoch, user.passwordChangedAt],
          );
        }
        await client.query(
          `INSERT INTO tanaghom.memberships (user_id, organization_id, role, is_active)
           SELECT u.id, au.organization_id, au.role, au.is_active
             FROM tanaghom.app_users au
             JOIN tanaghom.users u ON u.id = au.auth_subject
            WHERE au.kind = 'human' AND au.organization_id IS NOT NULL
           ON CONFLICT (user_id, organization_id) DO NOTHING`,
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async function createSession(client, { userId, organizationId, userAgent }) {
    const token = (await import("node:crypto")).randomBytes(32).toString("base64url");
    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    await client.query(
      `INSERT INTO tanaghom.sessions
         (id, token_hash, user_id, organization_id, user_agent, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
      [id, hashToken(token), userId, organizationId, userAgent ?? null, now, expiresAt],
    );
    return { id, token, expiresAt };
  }

  return {
    async load() {
      await importLegacyIfEmpty();
    },
    async refreshIfChanged() {
      // Postgres is the source of truth; there is nothing to reload.
    },
    async close() {
      await pool.end();
    },
    async size() {
      const result = await pool.query("SELECT count(*)::int AS count FROM tanaghom.users");
      return result.rows[0].count;
    },
    async list() {
      const result = await pool.query(
        `SELECT u.*, m.organization_id, o.name AS organization_name, m.role
           FROM tanaghom.users u
           LEFT JOIN LATERAL (
             SELECT membership.organization_id, membership.role
               FROM tanaghom.memberships membership
              WHERE membership.user_id = u.id AND membership.is_active
              ORDER BY (membership.role = 'owner') DESC, membership.created_at
              LIMIT 1
           ) m ON true
           LEFT JOIN tanaghom.organizations o ON o.id = m.organization_id
          ORDER BY u.email`,
      );
      return result.rows.map(mapRow);
    },
    findByEmail(email) {
      return readUser("u.email = $1", [normalizeEmail(email)]);
    },
    findBySub(sub) {
      return readUser("u.id = $1", [String(sub).toLowerCase()]);
    },
    async count() {
      const result = await pool.query("SELECT count(*)::int AS count FROM tanaghom.users");
      return result.rows[0].count;
    },
    async upsert({ email, sub, displayName = null, password, mustChangePassword = false, disabled = false }) {
      const normalized = normalizeEmail(email);
      if (!normalized.includes("@")) throw new StoreError("invalid email");
      const subject = (sub ?? randomUUID()).toLowerCase();
      if (!UUID_RE.test(subject)) throw new StoreError("invalid auth subject");
      const policy = passwordPolicyError(password, normalized);
      if (policy) throw new StoreError(policy);
      const passwordHash = await hashPassword(password);
      const result = await pool.query(
        `INSERT INTO tanaghom.users
           (id, email, password_hash, full_name, disabled, must_change_password,
            session_epoch, password_changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, now())
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               full_name = coalesce($4::text, tanaghom.users.full_name),
               disabled = EXCLUDED.disabled,
               must_change_password = EXCLUDED.must_change_password,
               session_epoch = tanaghom.users.session_epoch + 1,
               password_changed_at = now()
         RETURNING id`,
        [subject, normalized, passwordHash, displayName, disabled, mustChangePassword],
      );
      return this.findBySub(result.rows[0].id);
    },
    async setInitialPassword(email, password) {
      const policy = passwordPolicyError(password, email);
      if (policy) throw new StoreError(policy);
      const result = await pool.query(
        `UPDATE tanaghom.users
            SET password_hash = $2, must_change_password = false, password_changed_at = now(),
                session_epoch = session_epoch + 1
          WHERE email = $1
          RETURNING id`,
        [normalizeEmail(email), await hashPassword(password)],
      );
      if (!result.rows[0]) throw new StoreError("unknown auth user");
      return this.findBySub(result.rows[0].id);
    },
    async changePassword(email, password, { mustChangePassword = false } = {}) {
      const policy = passwordPolicyError(password, email);
      if (policy) throw new StoreError(policy);
      const result = await pool.query(
        `UPDATE tanaghom.users
            SET password_hash = $2, must_change_password = $3, password_changed_at = now(),
                session_epoch = session_epoch + 1
          WHERE email = $1
          RETURNING id`,
        [normalizeEmail(email), await hashPassword(password), mustChangePassword],
      );
      if (!result.rows[0]) throw new StoreError("unknown auth user");
      await this.revokeAllSessions(result.rows[0].id);
      return this.findBySub(result.rows[0].id);
    },
    async setDisabled(email, disabled) {
      const result = await pool.query(
        `UPDATE tanaghom.users
            SET disabled = $2, session_epoch = session_epoch + 1
          WHERE email = $1
          RETURNING id`,
        [normalizeEmail(email), disabled],
      );
      if (!result.rows[0]) throw new StoreError("unknown auth user");
      if (disabled) await this.revokeAllSessions(result.rows[0].id);
      return this.findBySub(result.rows[0].id);
    },
    async touchLogin(userId) {
      await pool.query("UPDATE tanaghom.users SET last_login_at = now() WHERE id = $1", [userId]);
    },
    async createSession({ userId, organizationId, userAgent }) {
      return withClient((client) => createSession(client, { userId, organizationId, userAgent }));
    },
    async findSession(token) {
      const hash = hashToken(token);
      const result = await pool.query(
        `SELECT s.*, o.name AS organization_name
           FROM tanaghom.sessions s
           JOIN tanaghom.organizations o ON o.id = s.organization_id
          WHERE s.token_hash = $1`,
        [hash],
      );
      const row = result.rows[0];
      if (!row) return null;
      const now = Date.now();
      if (new Date(row.expires_at).getTime() <= now) return null;
      if (now - new Date(row.last_seen_at).getTime() > SESSION_IDLE_MS) return null;
      return row;
    },
    async rotateSession(session, { userAgent } = {}) {
      const token = (await import("node:crypto")).randomBytes(32).toString("base64url");
      await pool.query(
        `UPDATE tanaghom.sessions
            SET token_hash = $2, last_seen_at = now(), user_agent = coalesce($3, user_agent)
          WHERE id = $1`,
        [session.id, hashToken(token), userAgent ?? null],
      );
      return token;
    },
    async touchSession(sessionId) {
      await pool.query("UPDATE tanaghom.sessions SET last_seen_at = now() WHERE id = $1", [sessionId]);
    },
    async listSessions(userId, currentSessionId) {
      const result = await pool.query(
        `SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, s.user_agent,
                o.name AS organization_name
           FROM tanaghom.sessions s
           JOIN tanaghom.organizations o ON o.id = s.organization_id
          WHERE s.user_id = $1 AND s.expires_at > now()
          ORDER BY s.last_seen_at DESC`,
        [userId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        organization_name: row.organization_name,
        created_at: row.created_at.toISOString(),
        last_seen_at: row.last_seen_at.toISOString(),
        expires_at: row.expires_at.toISOString(),
        user_agent: row.user_agent,
        current: row.id === currentSessionId,
      }));
    },
    async revokeSession(sessionId, userId) {
      const result = await pool.query(
        "UPDATE tanaghom.sessions SET expires_at = now() WHERE id = $1 AND user_id = $2 RETURNING id",
        [sessionId, userId],
      );
      return Boolean(result.rows[0]);
    },
    async revokeSessionByToken(token) {
      await pool.query("UPDATE tanaghom.sessions SET expires_at = now() WHERE token_hash = $1", [hashToken(token)]);
    },
    async revokeAllSessions(userId) {
      await pool.query("UPDATE tanaghom.sessions SET expires_at = now() WHERE user_id = $1", [userId]);
    },
    async signup({ email, password, fullName, organizationName, locale = "en", userAgent }) {
      const normalized = normalizeEmail(email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new StoreError("invalid_email");
      if (typeof fullName !== "string" || fullName.trim().length < 2) throw new StoreError("invalid_name");
      if (typeof organizationName !== "string" || organizationName.trim().length < 2) throw new StoreError("invalid_organization");
      const policy = passwordPolicyError(password, normalized);
      if (policy) throw new StoreError(policy);
      const passwordHash = await hashPassword(password);
      const localeValue = locale === "ar" ? "ar" : "en";

      return withClient(async (client) => {
        await client.query("BEGIN");
        try {
          const existing = await client.query("SELECT 1 FROM tanaghom.users WHERE email = $1", [normalized]);
          if (existing.rows[0]) throw new StoreError("email_taken");

          const base = slugify(organizationName);
          let slug = base;
          const firstTaken = await client.query("SELECT 1 FROM tanaghom.organizations WHERE slug = $1", [slug]);
          if (firstTaken.rows[0]) {
            const second = `${base}-2`;
            const secondTaken = await client.query("SELECT 1 FROM tanaghom.organizations WHERE slug = $1", [second]);
            slug = secondTaken.rows[0]
              ? `${base.slice(0, 68)}-${randomBytes(4).toString("hex")}`
              : second;
          }

          const org = await client.query(
            `INSERT INTO tanaghom.organizations (slug, name, status, default_locale)
             VALUES ($1, $2, 'trialing', $3) RETURNING id`,
            [slug, organizationName.trim().slice(0, 120), localeValue],
          );
          const organizationId = org.rows[0].id;

          const user = await client.query(
            `INSERT INTO tanaghom.users (email, password_hash, full_name, locale, must_change_password)
             VALUES ($1, $2, $3, $4, false) RETURNING id`,
            [normalized, passwordHash, fullName.trim().slice(0, 120), localeValue],
          );
          const userId = user.rows[0].id;

          await client.query(
            `INSERT INTO tanaghom.memberships (user_id, organization_id, role)
             VALUES ($1, $2, 'owner')`,
            [userId, organizationId],
          );

          const profile = await client.query(
            `INSERT INTO tanaghom.app_users
               (email, display_name, kind, role, is_active, auth_subject, organization_id, invited_at, accepted_at)
             VALUES ($1, $2, 'human', 'owner', true, $3, $4, now(), now())
             RETURNING id`,
            [normalized, fullName.trim().slice(0, 120), userId, organizationId],
          );

          await client.query(
            `INSERT INTO tanaghom.agent_actions_log
               (correlation_id, actor_user_id, action_type, entity_type, entity_id, payload, result)
             VALUES ($1, $2, 'auth.signup', 'organization', $3, $4::jsonb, 'success')`,
            [randomUUID(), profile.rows[0].id, organizationId, JSON.stringify({ locale: localeValue, slug })],
          );

          const session = await createSession(client, { userId, organizationId, userAgent });
          await client.query("COMMIT");
          return {
            user: await this.findBySub(userId),
            session,
            organizationId,
            organizationName: organizationName.trim().slice(0, 120),
          };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });
    },
    async deleteUser(userId) {
      await pool.query("DELETE FROM tanaghom.users WHERE id = $1", [userId]);
    },
  };
}

export function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}
