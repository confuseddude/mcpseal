// build-bible.md Part 8.1/9: org policy-signing key management. The App API
// signs policies ON BEHALF OF the org, so the private key must live
// server-side — but CLAUDE.md invariant 6 ("secrets... never in a
// plaintext dotfile, log line, or committed file") applies here too: the
// private key is encrypted at rest with AES-256-GCM, never stored plain.
//
// PRODUCTION WIRING REQUIRED: MCPSEAL_MASTER_KEY must be a real secret
// from a real KMS/secrets-manager in production. The dev fallback below is
// clearly insecure and only exists so local dev doesn't require operator
// setup — it must never be reachable in a deployed environment.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";

function getMasterKey(): Buffer {
  const hex = process.env.MCPSEAL_MASTER_KEY;
  if (hex) {
    const key = Buffer.from(hex, "hex");
    if (key.length !== 32) throw new Error("MCPSEAL_MASTER_KEY must be 32 bytes (64 hex chars)");
    return key;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MCPSEAL_MASTER_KEY is required in production — refusing to use an insecure dev default");
  }
  // Deterministic ONLY for local dev convenience (so restarting the dev
  // server against the same SQLite file doesn't orphan already-encrypted
  // keys); never used when NODE_ENV=production (checked above).
  return Buffer.from("0".repeat(64), "hex");
}

export function encryptPrivateKey(privateKeyHex: string): string {
  const key = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKeyHex, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("hex");
}

export function decryptPrivateKey(encryptedHex: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(encryptedHex, "hex");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  // GCM authentication failure throws here — a tampered/corrupted
  // ciphertext cannot silently decrypt to the wrong key.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

export function generateOrgSigningKeypair(): { publicKeyHex: string; encryptedPrivateKey: string } {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const privateKeyHex = Buffer.from(privateKey).toString("hex");
  return { publicKeyHex: Buffer.from(publicKey).toString("hex"), encryptedPrivateKey: encryptPrivateKey(privateKeyHex) };
}

// SCIM bearer tokens are full-entropy random secrets (not low-entropy
// passwords), so a fast SHA-256 lookup hash is appropriate here — unlike
// the workspace API keys (services/ingest/src/crypto.ts), which use
// argon2 because that's a password-shaped secret space where the extra
// work factor matters.
export function generateScimToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

export function hashScimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function signWithOrgKey(encryptedPrivateKey: string, message: string): string {
  const privateKeyHex = decryptPrivateKey(encryptedPrivateKey);
  const privateKey = Buffer.from(privateKeyHex, "hex");
  const signature = ed25519.sign(Buffer.from(message, "utf-8"), privateKey);
  return Buffer.from(signature).toString("hex");
}
