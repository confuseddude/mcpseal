import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { ed25519 } from "@noble/curves/ed25519.js";
import { buildApp } from "./app.js";
import { encryptPrivateKey, decryptPrivateKey, generateOrgSigningKeypair, signWithOrgKey } from "./org-crypto.js";

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  const match = header?.match(/mcplock_session=([^;]+)/);
  if (!match) throw new Error("no session cookie in response");
  return `mcplock_session=${match[1]}`;
}

async function loginAs(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email } });
  const cookie = extractCookie(res.headers["set-cookie"]);
  return { cookie, ...res.json().user };
}

describe("org-crypto: private-key encryption at rest", () => {
  it("round-trips a private key through AES-256-GCM encryption", () => {
    const encrypted = encryptPrivateKey("deadbeef".repeat(8));
    expect(encrypted).not.toContain("deadbeef");
    expect(decryptPrivateKey(encrypted)).toBe("deadbeef".repeat(8));
  });

  it("throws (does not silently decrypt) on a tampered ciphertext", () => {
    const encrypted = encryptPrivateKey("cafebabe".repeat(8));
    const tampered = encrypted.slice(0, -2) + (encrypted.slice(-2) === "00" ? "11" : "00");
    expect(() => decryptPrivateKey(tampered)).toThrow();
  });

  it("generateOrgSigningKeypair produces a keypair whose signature verifies with @noble/curves directly", () => {
    const { publicKeyHex, encryptedPrivateKey } = generateOrgSigningKeypair();
    const signature = signWithOrgKey(encryptedPrivateKey, "hello org");
    const ok = ed25519.verify(Buffer.from(signature, "hex"), Buffer.from("hello org", "utf-8"), Buffer.from(publicKeyHex, "hex"));
    expect(ok).toBe(true);
  });
});

describe("policy signing end-to-end (build-bible Part 8.1)", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp(":memory:");
  });

  it("an org gets a signing key automatically on first login", async () => {
    const owner = await loginAs(app, "sig1@acme.com");
    const res = await app.inject({ method: "GET", url: "/v1/policy/signing-key", headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a created policy carries a real signature verifiable against the org's pinned public key", async () => {
    const owner = await loginAs(app, "sig2@acme.com");
    const keyRes = await app.inject({ method: "GET", url: "/v1/policy/signing-key", headers: { cookie: owner.cookie } });
    const publicKeyHex = keyRes.json().publicKey;

    const lockfileJson = JSON.stringify({ version: 1, servers: { github: {} } });
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/policies",
      headers: { cookie: owner.cookie },
      payload: { lockfileJson },
    });
    const policy = createRes.json().policy;
    expect(policy.signature).toMatch(/^[0-9a-f]+$/);

    const verified = ed25519.verify(
      Buffer.from(policy.signature, "hex"),
      Buffer.from(policy.lockfileJson, "utf-8"),
      Buffer.from(publicKeyHex, "hex")
    );
    expect(verified).toBe(true);
  });

  it("a tampered lockfileJson fails verification against the real signature — the core attack this exists to stop", async () => {
    const owner = await loginAs(app, "sig3@acme.com");
    const keyRes = await app.inject({ method: "GET", url: "/v1/policy/signing-key", headers: { cookie: owner.cookie } });
    const publicKeyHex = keyRes.json().publicKey;

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/policies",
      headers: { cookie: owner.cookie },
      payload: { lockfileJson: JSON.stringify({ version: 1, servers: {} }) },
    });
    const policy = createRes.json().policy;

    const tamperedLockfile = JSON.stringify({ version: 1, servers: { evil: { tools: { steal_secrets: { status: "approved" } } } } });
    const verified = ed25519.verify(Buffer.from(policy.signature, "hex"), Buffer.from(tamperedLockfile, "utf-8"), Buffer.from(publicKeyHex, "hex"));
    expect(verified).toBe(false);
  });

  it("a policy signed by a DIFFERENT org's key fails verification against this org's pinned public key", async () => {
    const ownerA = await loginAs(app, "sig4@acme.com");
    const ownerB = await loginAs(app, "sig4@othercorp.com");

    const keyA = (await app.inject({ method: "GET", url: "/v1/policy/signing-key", headers: { cookie: ownerA.cookie } })).json()
      .publicKey;

    const policyB = (
      await app.inject({
        method: "POST",
        url: "/v1/policies",
        headers: { cookie: ownerB.cookie },
        payload: { lockfileJson: JSON.stringify({ version: 1, servers: {} }) },
      })
    ).json().policy;

    // Org A's pinned key must never validate a signature actually produced
    // by org B's key — this is what stops one org's compromised/malicious
    // policy push from being accepted by another org's fleet.
    const verified = ed25519.verify(
      Buffer.from(policyB.signature, "hex"),
      Buffer.from(policyB.lockfileJson, "utf-8"),
      Buffer.from(keyA, "hex")
    );
    expect(verified).toBe(false);
  });

  it("each org's signing key is stable across multiple policy versions (not rotated per-policy)", async () => {
    const owner = await loginAs(app, "sig5@acme.com");
    const key1 = (await app.inject({ method: "GET", url: "/v1/policy/signing-key", headers: { cookie: owner.cookie } })).json()
      .publicKey;
    await app.inject({
      method: "POST",
      url: "/v1/policies",
      headers: { cookie: owner.cookie },
      payload: { lockfileJson: JSON.stringify({ version: 1 }) },
    });
    const key2 = (await app.inject({ method: "GET", url: "/v1/policy/signing-key", headers: { cookie: owner.cookie } })).json()
      .publicKey;
    expect(key2).toBe(key1);
  });
});
