// build-bible.md Part 4.3/6.2: "the CLI generates its ed25519 machine
// keypair and registers the public key to the workspace." The private key
// never leaves the machine (Part 9) — it lives only in the OS keychain
// (keychain.ts), keyed separately from the workspace API key so revoking
// one doesn't require touching the other.
import { ed25519 } from "@noble/curves/ed25519.js";
import { getSecret, setSecret } from "./keychain.js";

const PRIVATE_KEY_ACCOUNT = "machine-private-key";

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

export interface MachineIdentity {
  privateKeyHex: string;
  publicKeyHex: string;
}

// Idempotent: an existing keypair (from a prior login) is reused rather
// than silently replaced, since a new keypair would need re-registration
// and would orphan the previously-registered public key.
export function loadOrCreateMachineIdentity(): MachineIdentity {
  const existing = getSecret(PRIVATE_KEY_ACCOUNT);
  if (existing) {
    const privateKey = hexToBytes(existing);
    const publicKey = ed25519.getPublicKey(privateKey);
    return { privateKeyHex: existing, publicKeyHex: bytesToHex(publicKey) };
  }
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const privateKeyHex = bytesToHex(privateKey);
  setSecret(PRIVATE_KEY_ACCOUNT, privateKeyHex);
  return { privateKeyHex, publicKeyHex: bytesToHex(publicKey) };
}

export function signWithMachineKey(privateKeyHex: string, message: Uint8Array): string {
  const signature = ed25519.sign(message, hexToBytes(privateKeyHex));
  return bytesToHex(signature);
}
