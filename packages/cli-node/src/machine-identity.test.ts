import { describe, it, expect, afterEach } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { loadOrCreateMachineIdentity, signWithMachineKey } from "./machine-identity.js";
import { deleteSecret } from "./keychain.js";

const PRIVATE_KEY_ACCOUNT = "machine-private-key";

describe("machine-identity", () => {
  afterEach(() => {
    deleteSecret(PRIVATE_KEY_ACCOUNT);
  });

  it("creates a fresh ed25519 keypair when none exists", () => {
    deleteSecret(PRIVATE_KEY_ACCOUNT);
    const identity = loadOrCreateMachineIdentity();
    expect(identity.privateKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses an existing keypair on subsequent calls (idempotent)", () => {
    const first = loadOrCreateMachineIdentity();
    const second = loadOrCreateMachineIdentity();
    expect(second.privateKeyHex).toBe(first.privateKeyHex);
    expect(second.publicKeyHex).toBe(first.publicKeyHex);
  });

  it("produces a valid ed25519 signature verifiable against the public key", () => {
    const identity = loadOrCreateMachineIdentity();
    const message = Buffer.from("hello mcplock", "utf-8");
    const signatureHex = signWithMachineKey(identity.privateKeyHex, message);
    const sig = Buffer.from(signatureHex, "hex");
    const pub = Buffer.from(identity.publicKeyHex, "hex");
    expect(ed25519.verify(sig, message, pub)).toBe(true);
  });

  it("a signature does not verify against a tampered message", () => {
    const identity = loadOrCreateMachineIdentity();
    const message = Buffer.from("hello mcplock", "utf-8");
    const signatureHex = signWithMachineKey(identity.privateKeyHex, message);
    const sig = Buffer.from(signatureHex, "hex");
    const pub = Buffer.from(identity.publicKeyHex, "hex");
    const tampered = Buffer.from("hello mcplock!", "utf-8");
    expect(ed25519.verify(sig, tampered, pub)).toBe(false);
  });
});
