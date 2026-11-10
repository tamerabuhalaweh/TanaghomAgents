#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { MIN_PASSWORD_LENGTH, passwordPolicyError } from "./passwords.mjs";
import { createUserStore } from "./store.mjs";

const STORE_FILE = process.env.AUTH_STORE_FILE ?? "/data/auth-users.json";
const SEED_FILE = process.env.AUTH_SEED_FILE ?? "/run/secrets/auth_users";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usage() {
  console.error(`usage: admin.mjs <list|upsert|reset|disable|enable> [options]

  list
  upsert --email <address> [--sub <uuid>] [--name <display name>] (--stdin-password|--generate)
  reset  --email <address> [--sub <uuid>] [--name <display name>] (--stdin-password|--generate)
  disable --email <address>
  enable  --email <address>

Passwords are read from stdin or generated once and printed to stdout. Never
pass a password as an argument: it would land in the process list.`);
}

function parse(argv) {
  const [command, ...rest] = argv;
  const options = { command, generate: false, stdinPassword: false };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--generate") options.generate = true;
    else if (token === "--stdin-password") options.stdinPassword = true;
    else if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
      options[key] = value;
      index += 1;
    } else {
      throw new Error(`unexpected argument: ${token}`);
    }
  }
  return options;
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()));
    process.stdin.on("error", () => resolve(""));
  });
}

function generatePassword() {
  // 24 random bytes -> 32 base64url characters, always above the length floor.
  return randomBytes(24).toString("base64url");
}

function requireEmail(options) {
  const email = String(options.email ?? "").trim().toLowerCase();
  if (!email.includes("@") || email.length > 320) throw new Error("--email is required");
  return email;
}

async function passwordFrom(options, email) {
  let password;
  if (options.generate) {
    password = generatePassword();
  } else if (options.stdinPassword) {
    password = await readStdin();
  } else {
    throw new Error("pass one of --stdin-password or --generate");
  }
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const policy = passwordPolicyError(password, email);
  if (policy) throw new Error(`password rejected by policy: ${policy}`);
  return password;
}

function summarize(user, { generatedPassword } = {}) {
  console.log(`EMAIL=${user.email}`);
  console.log(`SUB=${user.sub}`);
  console.log(`STATUS=${user.disabled ? "disabled" : "active"}`);
  console.log(`MUST_CHANGE_PASSWORD=${user.mustChangePassword ? "true" : "false"}`);
  if (generatedPassword) console.log(`PASSWORD=${generatedPassword}`);
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (!["list", "upsert", "reset", "disable", "enable"].includes(options.command)) {
    usage();
    process.exit(2);
  }
  const store = createUserStore({ file: STORE_FILE, seedFile: SEED_FILE });
  await store.load();

  if (options.command === "list") {
    for (const user of store.list()) {
      console.log([
        user.email,
        user.sub,
        user.disabled ? "disabled" : "active",
        user.mustChangePassword ? "must-change" : "ready",
        user.passwordChangedAt ?? "never",
      ].join("\t"));
    }
    return;
  }

  const email = requireEmail(options);
  if (options.command === "disable" || options.command === "enable") {
    const user = store.setDisabled(email, options.command === "disable");
    summarize(user);
    return;
  }

  if (options.sub && !UUID_RE.test(options.sub)) throw new Error("--sub must be a UUID");
  const password = await passwordFrom(options, email);
  const existing = store.findByEmail(email);
  if (options.command === "upsert" && existing) {
    const user = await store.changePassword(email, password, { mustChangePassword: true });
    summarize(user);
    return;
  }
  const user = await store.upsert({
    email,
    sub: options.sub ?? existing?.sub ?? randomUUID(),
    displayName: options.name ?? existing?.displayName ?? null,
    password,
    mustChangePassword: true,
  });
  summarize(user);
}

main().catch((error) => {
  console.error(`ADMIN_ERROR ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
