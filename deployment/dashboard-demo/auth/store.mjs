import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { hashPassword } from "./passwords.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_VERSION = 1;

export class StoreError extends Error {}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeUser(item) {
  if (!item || typeof item !== "object") throw new StoreError("invalid auth user entry");
  const email = normalizeEmail(item.email);
  const sub = typeof item.sub === "string" ? item.sub.toLowerCase() : "";
  if (!email.includes("@") || email.length > 320 || !UUID_RE.test(sub)) {
    throw new StoreError("invalid auth user value");
  }
  if (typeof item.passwordHash !== "string" || !item.passwordHash.startsWith("scrypt$")) {
    throw new StoreError("auth user is missing a scrypt password hash");
  }
  return {
    email,
    sub,
    displayName: typeof item.displayName === "string" ? item.displayName.slice(0, 120) : null,
    passwordHash: item.passwordHash,
    disabled: item.disabled === true,
    mustChangePassword: item.mustChangePassword === true,
    sessionEpoch: Number.isInteger(item.sessionEpoch) && item.sessionEpoch >= 0 ? item.sessionEpoch : 0,
    passwordChangedAt: typeof item.passwordChangedAt === "string" ? item.passwordChangedAt : null,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
  };
}

function sortUsers(users) {
  return [...users].sort((a, b) => a.email.localeCompare(b.email));
}

export function createUserStore({ file, seedFile, seedIfMissing = true }) {
  if (!file) throw new StoreError("auth store file is required");
  let users = new Map();
  let bySub = new Map();
  let mtimeMs = -1;

  function apply(list) {
    const nextUsers = new Map();
    const nextBySub = new Map();
    for (const user of list) {
      if (nextUsers.has(user.email)) throw new StoreError("duplicate auth user email");
      if (nextBySub.has(user.sub)) throw new StoreError("duplicate auth user subject");
      nextUsers.set(user.email, user);
      nextBySub.set(user.sub, user);
    }
    users = nextUsers;
    bySub = nextBySub;
  }

  function readStoreFile() {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.users)) {
      throw new StoreError("unsupported auth store format");
    }
    return parsed.users.map(normalizeUser);
  }

  function persist() {
    const payload = JSON.stringify({ version: STORE_VERSION, users: sortUsers(users.values()) }, null, 2) + "\n";
    const temporary = join(dirname(file), `.auth-users.${process.pid}.${randomUUID()}.tmp`);
    const fd = openSync(temporary, "w", 0o600);
    try {
      writeSync(fd, payload);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
    try {
      chmodSync(file, 0o600);
    } catch {
      // best-effort on filesystems that ignore POSIX modes
    }
    mtimeMs = statSync(file).mtimeMs;
  }

  async function seedFromLegacy() {
    if (!existsSync(seedFile)) throw new StoreError("auth user store is missing and no seed file exists");
    const parsed = JSON.parse(readFileSync(seedFile, "utf8"));
    if (!parsed || !Array.isArray(parsed.users)) throw new StoreError("invalid auth seed file");
    const migrated = [];
    for (const item of parsed.users) {
      if (!item || typeof item.email !== "string" || typeof item.sub !== "string" || typeof item.password !== "string") {
        throw new StoreError("invalid auth seed entry");
      }
      const password = item.password;
      if (password.length < 12 || password.length > 512) throw new StoreError("invalid auth seed password");
      migrated.push(normalizeUser({
        email: item.email,
        sub: item.sub,
        displayName: item.display_name ?? item.displayName ?? null,
        passwordHash: await hashPassword(password),
        disabled: false,
        mustChangePassword: item.must_change_password === true,
        sessionEpoch: 0,
        passwordChangedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }));
    }
    apply(migrated);
    persist();
  }

  async function load() {
    if (!seedIfMissing && !existsSync(file)) throw new StoreError("auth user store is missing");
    if (existsSync(file)) {
      apply(readStoreFile());
      mtimeMs = statSync(file).mtimeMs;
    } else {
      await seedFromLegacy();
    }
  }

  // Called on every request: reload when an operator used the admin CLI.
  async function refreshIfChanged() {
    if (!existsSync(file)) return;
    const current = statSync(file).mtimeMs;
    if (current === mtimeMs) return;
    apply(readStoreFile());
    mtimeMs = current;
  }

  function save(next) {
    const previousUsers = users;
    const previousBySub = bySub;
    apply([...next.values()]);
    try {
      persist();
    } catch (error) {
      users = previousUsers;
      bySub = previousBySub;
      throw error;
    }
  }

  return {
    async load() {
      await load();
    },
    async refreshIfChanged() {
      await refreshIfChanged();
    },
    get size() {
      return users.size;
    },
    list() {
      return sortUsers(users.values());
    },
    findByEmail(email) {
      return users.get(normalizeEmail(email)) ?? null;
    },
    findBySub(sub) {
      return bySub.get(String(sub).toLowerCase()) ?? null;
    },
    async upsert({ email, sub, displayName = null, password, mustChangePassword = false, disabled = false }) {
      const normalized = normalizeEmail(email);
      if (!normalized.includes("@")) throw new StoreError("invalid email");
      const subject = (sub ?? randomUUID()).toLowerCase();
      if (!UUID_RE.test(subject)) throw new StoreError("invalid auth subject");
      const existing = users.get(normalized);
      if (existing && existing.sub !== subject) throw new StoreError("auth subject already belongs to another account");
      const next = new Map(users);
      const now = new Date().toISOString();
      next.set(normalized, normalizeUser({
        email: normalized,
        sub: subject,
        displayName: displayName ?? existing?.displayName ?? null,
        passwordHash: await hashPassword(password),
        disabled,
        mustChangePassword,
        sessionEpoch: (existing?.sessionEpoch ?? 0) + 1,
        passwordChangedAt: now,
        createdAt: existing?.createdAt ?? now,
      }));
      save(next);
      return users.get(normalized);
    },
    // Used by the invite flow and by an operator-created account: sets the
    // first password without invalidating the session that is setting it.
    async setInitialPassword(email, password) {
      const normalized = normalizeEmail(email);
      const existing = users.get(normalized);
      if (!existing) throw new StoreError("unknown auth user");
      const next = new Map(users);
      next.set(normalized, {
        ...existing,
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        passwordChangedAt: new Date().toISOString(),
      });
      save(next);
      return users.get(normalized);
    },
    async changePassword(email, password, { mustChangePassword = false } = {}) {
      const normalized = normalizeEmail(email);
      const existing = users.get(normalized);
      if (!existing) throw new StoreError("unknown auth user");
      const next = new Map(users);
      next.set(normalized, {
        ...existing,
        passwordHash: await hashPassword(password),
        mustChangePassword,
        sessionEpoch: existing.sessionEpoch + 1,
        passwordChangedAt: new Date().toISOString(),
      });
      save(next);
      return users.get(normalized);
    },
    setDisabled(email, disabled) {
      const normalized = normalizeEmail(email);
      const existing = users.get(normalized);
      if (!existing) throw new StoreError("unknown auth user");
      const next = new Map(users);
      next.set(normalized, { ...existing, disabled, sessionEpoch: existing.sessionEpoch + 1 });
      save(next);
      return users.get(normalized);
    },
  };
}
