import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// BYOK keys at rest: AES-256-GCM with a server-only secret. If the DB ever
// leaks, the keys don't. No PEDIA_KEY_SECRET → BYOK is simply unavailable.

function secretKey(): Buffer | null {
  const s = process.env.PEDIA_KEY_SECRET;
  if (!s || s.length < 16) return null;
  return createHash("sha256").update(s).digest();
}

export function byokConfigured(): boolean {
  return secretKey() !== null;
}

/** base64(iv | authTag | ciphertext) */
export function encryptSecret(plain: string): string | null {
  const key = secretKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(payload: string): string | null {
  const key = secretKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(payload, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
