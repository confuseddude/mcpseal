// Signature verification (build-bible Part 4.3) and API-key hashing
// (Part 5.1: "store hashes of secrets, never the secrets"). Uses
// @noble/ed25519's audited curve implementation via @noble/curves and
// argon2 for key hashing — both maintained libraries, per CLAUDE.md's
// crypto-dependency rule. Never hand-roll either.
import { ed25519 } from "@noble/curves/ed25519.js";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";

export function verifyEd25519(signatureHex: string, messageBytes: Uint8Array, publicKeyHex: string): boolean {
  try {
    const sig = hexToBytes(signatureHex);
    const pub = hexToBytes(publicKeyHex);
    return ed25519.verify(sig, messageBytes, pub);
  } catch {
    // Malformed hex, wrong-length key/sig, etc. — never throw into the
    // caller; a verification failure must resolve to "not verified".
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("invalid hex");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Workspace API key shape: "<keyId>.<secret>" — keyId is a public lookup
// handle (indexed), secret is the part that's hashed at rest and never
// stored in plaintext, matching Part 5.1's "hashes of secrets, never the
// secrets."
export function generateApiKey(): { keyId: string; secret: string; token: string } {
  const keyId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return { keyId, secret, token: `${keyId}.${secret}` };
}

export function parseApiKeyToken(token: string): { keyId: string; secret: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { keyId: parts[0], secret: parts[1] };
}

export async function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret);
}

export async function verifySecret(hash: string, secret: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}
