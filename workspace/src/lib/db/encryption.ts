/**
 * AES-256-GCM encryption for sensitive data at rest.
 *
 * Used for: memory vault entries, document content (if cached).
 * NOT used for: user emails, project names (these are plaintext for search).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY not set. Required for data encryption.");
  }
  // Key should be 32 bytes (64 hex chars)
  return Buffer.from(key, "hex");
}

/**
 * Encrypt a string value. Returns base64-encoded ciphertext with IV and auth tag prepended.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: IV (12 bytes) + TAG (16 bytes) + CIPHERTEXT
  const result = Buffer.concat([iv, tag, encrypted]);
  return result.toString("base64");
}

/**
 * Decrypt a base64-encoded ciphertext.
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const data = Buffer.from(ciphertext, "base64");

  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Generate a new 256-bit encryption key (for initial setup).
 */
export function generateKey(): string {
  return randomBytes(32).toString("hex");
}
