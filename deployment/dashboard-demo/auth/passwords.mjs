import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

// OWASP-recommended scrypt parameters for interactive logins (N=2^15, r=8, p=1).
export const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 });
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
const COMMON_FRAGMENTS = ["password", "tanaghom", "qwerty", "123456", "letmein", "admin123", "changeme"];

export function passwordPolicyError(password, email = "") {
  if (typeof password !== "string" || password.length === 0) return "password_required";
  if (password.length < MIN_PASSWORD_LENGTH) return "password_too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "password_too_long";
  if (new Set(password).size < 8) return "password_too_simple";
  const lower = password.toLowerCase();
  if (COMMON_FRAGMENTS.some((fragment) => lower.includes(fragment))) return "password_too_common";
  const local = typeof email === "string" ? email.split("@")[0].trim().toLowerCase() : "";
  if (local.length >= 4 && lower.includes(local)) return "password_contains_email";
  return null;
}

async function derive(password, salt, keylen = SCRYPT.keylen, params = SCRYPT) {
  return scrypt(password.normalize("NFKC"), salt, keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem ?? SCRYPT.maxmem,
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    Buffer.from(derived).toString("base64"),
  ].join("$");
}

export async function verifyPassword(encoded, password) {
  if (typeof encoded !== "string" || typeof password !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return false;
  // Refuse absurd parameters so a corrupted store cannot exhaust the process.
  if (params.N < 16384 || params.N > 1_048_576) return false;
  if (params.r < 8 || params.r > 32 || params.p < 1 || params.p > 8) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (salt.length < 16 || expected.length < 32) return false;
  const derived = Buffer.from(await derive(password, salt, expected.length, { ...params, maxmem: 256 * 1024 * 1024 }));
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

let dummyHash;
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(18).toString("base64url"));
  return dummyHash;
}

// Verify against an unknown account so a missing email costs the same as a
// wrong password. Always returns false.
export async function burnPasswordCheck(password) {
  await verifyPassword(await dummyPasswordHash(), password);
  return false;
}
