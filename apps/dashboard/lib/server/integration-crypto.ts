import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedCredential {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
  lastFour: string;
}

export class IntegrationCryptoError extends Error {}

function credentialKey() {
  const encoded = process.env.INTEGRATION_CREDENTIAL_KEY?.trim();
  if (!encoded) throw new IntegrationCryptoError("credential_encryption_not_configured");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new IntegrationCryptoError("credential_encryption_key_invalid");
  return key;
}

function keyVersion() {
  const version = Number(process.env.INTEGRATION_CREDENTIAL_KEY_VERSION || "1");
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new IntegrationCryptoError("credential_encryption_version_invalid");
  }
  return version;
}

export function integrationEncryptionConfigured() {
  try {
    credentialKey();
    keyVersion();
    return true;
  } catch {
    return false;
  }
}

export function encryptCredential(secret: string): EncryptedCredential {
  const normalized = secret.trim();
  if (normalized.length < 8 || normalized.length > 16_384) {
    throw new IntegrationCryptoError("credential_value_invalid");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  return {
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    keyVersion: keyVersion(),
    lastFour: normalized.slice(-4),
  };
}

export function decryptCredential(input: {
  credential_ciphertext: Buffer;
  credential_nonce: Buffer;
  credential_auth_tag: Buffer;
  credential_key_version: number;
}) {
  if (input.credential_key_version !== keyVersion()) {
    throw new IntegrationCryptoError("credential_key_version_unavailable");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", credentialKey(), input.credential_nonce);
    decipher.setAuthTag(input.credential_auth_tag);
    return Buffer.concat([
      decipher.update(input.credential_ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new IntegrationCryptoError("credential_decryption_failed");
  }
}
