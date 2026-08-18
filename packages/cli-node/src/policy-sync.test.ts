// build-bible.md Part 8.1 / Part 9 / Part 13 attack matrix — the pushed-
// policy channel is explicitly called out as the highest-value attack
// surface in the whole system. Every rejection path here must leave the
// existing .mcp-lock.json byte-for-byte untouched; that invariant is
// checked explicitly in nearly every test below, not just the outcome
// code.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { pullAndApplyPolicy } from "./policy-sync.js";
import { writeConfig } from "./config.js";

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function makeOrgKeypair() {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKeyHex = bytesToHex(ed25519.getPublicKey(privateKey));
  return {
    publicKeyHex,
    sign: (message: string) => bytesToHex(ed25519.sign(Buffer.from(message, "utf-8"), privateKey)),
  };
}

function mockFetchJson(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("pullAndApplyPolicy — signed policy verification attack matrix", () => {
  let tmpDir: string;
  let cfgPath: string;
  let lockfilePath: string;

  function setup(orgPublicKeyHex?: string, lastAppliedPolicyVersion?: number) {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcplock-policy-sync-test-"));
    cfgPath = path.join(tmpDir, "config.json");
    lockfilePath = path.join(tmpDir, ".mcp-lock.json");
    writeConfig(
      { workspaceId: randomUUID(), machineId: randomUUID(), ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex, lastAppliedPolicyVersion },
      cfgPath
    );
  }

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("VALID policy: correctly signed, newer version — accepted and applied atomically", async () => {
    setup();
    const org = makeOrgKeypair();
    // Pin the key first (simulating what login() does), then re-load via a fresh setup call isn't needed —
    // just rewrite config with the pinned key now that we have it.
    writeConfig({ workspaceId: "w", machineId: "m", ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex: org.publicKeyHex }, cfgPath);

    const lockfileJson = JSON.stringify({ version: 1, servers: { github: { tools: {} } } });
    const fetchImpl = mockFetchJson(200, { version: 1, lockfileJson, signature: org.sign(lockfileJson) });

    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: "k.s" });
    expect(result).toEqual({ outcome: "applied", version: 1 });
    expect(readFileSync(lockfilePath, "utf-8")).toBe(lockfileJson);
  });

  it("MODIFIED policy: signature doesn't match the (tampered) body — rejected, lockfile untouched", async () => {
    setup(undefined);
    const org = makeOrgKeypair();
    writeConfig({ workspaceId: "w", machineId: "m", ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex: org.publicKeyHex }, cfgPath);
    writeFileSync(lockfilePath, "ORIGINAL-LOCKFILE-CONTENT", "utf-8");

    const originalLockfile = JSON.stringify({ version: 1, servers: {} });
    const signature = org.sign(originalLockfile); // sign the ORIGINAL...
    const tamperedLockfile = JSON.stringify({ version: 1, servers: { evil: { tools: { steal: { status: "approved" } } } } }); // ...but ship the TAMPERED body
    const fetchImpl = mockFetchJson(200, { version: 1, lockfileJson: tamperedLockfile, signature });

    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: "k.s" });
    expect(result).toEqual({ outcome: "rejected-invalid-signature" });
    expect(readFileSync(lockfilePath, "utf-8")).toBe("ORIGINAL-LOCKFILE-CONTENT");
  });

  it("WRONG ORG KEY: validly signed by a DIFFERENT org's key — rejected against our pinned key", async () => {
    setup();
    const ourOrg = makeOrgKeypair();
    const attackerOrg = makeOrgKeypair();
    writeConfig({ workspaceId: "w", machineId: "m", ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex: ourOrg.publicKeyHex }, cfgPath);
    writeFileSync(lockfilePath, "ORIGINAL", "utf-8");

    const lockfileJson = JSON.stringify({ version: 1, servers: {} });
    const fetchImpl = mockFetchJson(200, { version: 1, lockfileJson, signature: attackerOrg.sign(lockfileJson) });

    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: "k.s" });
    expect(result).toEqual({ outcome: "rejected-invalid-signature" });
    expect(readFileSync(lockfilePath, "utf-8")).toBe("ORIGINAL");
  });

  it("INVALID SIGNATURE: garbage/malformed signature hex — rejected, does not throw", async () => {
    setup();
    const org = makeOrgKeypair();
    writeConfig({ workspaceId: "w", machineId: "m", ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex: org.publicKeyHex }, cfgPath);
    writeFileSync(lockfilePath, "ORIGINAL", "utf-8");

    const fetchImpl = mockFetchJson(200, { version: 1, lockfileJson: '{"version":1}', signature: "not-valid-hex-!!!" });
    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: "k.s" });
    expect(result).toEqual({ outcome: "rejected-invalid-signature" });
    expect(readFileSync(lockfilePath, "utf-8")).toBe("ORIGINAL");
  });

  it("MALFORMED policy: response missing required fields — rejected, lockfile untouched", async () => {
    setup();
    const org = makeOrgKeypair();
    writeConfig({ workspaceId: "w", machineId: "m", ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex: org.publicKeyHex }, cfgPath);
    writeFileSync(lockfilePath, "ORIGINAL", "utf-8");

    const fetchImpl = mockFetchJson(200, { signature: "aabbcc" }); // no version, no lockfileJson
    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: "k.s" });
    expect(result).toEqual({ outcome: "rejected-malformed-response" });
    expect(readFileSync(lockfilePath, "utf-8")).toBe("ORIGINAL");
  });

  it("REPLAY / OLD VERSION: server returns a version we've already applied — no-op, not a downgrade", async () => {
    setup(undefined, 5);
    const org = makeOrgKeypair();
    writeConfig(
      { workspaceId: "w", machineId: "m", ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex: org.publicKeyHex, lastAppliedPolicyVersion: 5 },
      cfgPath
    );
    writeFileSync(lockfilePath, "VERSION-5-CONTENT", "utf-8");

    const oldLockfileJson = JSON.stringify({ version: 3 });
    const fetchImpl = mockFetchJson(200, { version: 3, lockfileJson: oldLockfileJson, signature: org.sign(oldLockfileJson) });

    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: "k.s" });
    expect(result).toEqual({ outcome: "no-newer-version", currentVersion: 5 });
    expect(readFileSync(lockfilePath, "utf-8")).toBe("VERSION-5-CONTENT");
  });

  it("INTERRUPTED DOWNLOAD: fetch throws mid-request — existing policy remains active", async () => {
    setup();
    const org = makeOrgKeypair();
    writeConfig({ workspaceId: "w", machineId: "m", ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex: org.publicKeyHex }, cfgPath);
    writeFileSync(lockfilePath, "ORIGINAL", "utf-8");

    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: "k.s" });
    expect(result.outcome).toBe("rejected-network-error");
    expect(readFileSync(lockfilePath, "utf-8")).toBe("ORIGINAL");
  });

  it("SIGNATURE VERIFICATION FAILURE fails closed even with no pinned key at all", async () => {
    setup(undefined); // no orgPublicKeyHex pinned
    writeFileSync(lockfilePath, "ORIGINAL", "utf-8");
    const fetchImpl = (() => {
      throw new Error("must never be called — should short-circuit before any network request");
    }) as unknown as typeof fetch;

    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: "k.s" });
    expect(result).toEqual({ outcome: "skipped-no-pinned-key" });
    expect(readFileSync(lockfilePath, "utf-8")).toBe("ORIGINAL");
  });

  it("not logged in (no config at all): skips cleanly, never calls fetch", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcplock-policy-sync-test-"));
    cfgPath = path.join(tmpDir, "config.json"); // never written
    lockfilePath = path.join(tmpDir, ".mcp-lock.json");
    const fetchImpl = (() => {
      throw new Error("must never be called when not logged in");
    }) as unknown as typeof fetch;

    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: undefined });
    expect(result).toEqual({ outcome: "skipped-not-logged-in" });
  });

  it("a newer, correctly-signed version DOES get applied even after a prior rejected attempt", async () => {
    setup();
    const org = makeOrgKeypair();
    writeConfig({ workspaceId: "w", machineId: "m", ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex: org.publicKeyHex }, cfgPath);
    writeFileSync(lockfilePath, "ORIGINAL", "utf-8");

    // First: a rejected forged attempt.
    const forgedFetch = mockFetchJson(200, { version: 1, lockfileJson: '{"version":1}', signature: "00".repeat(64) });
    const rejected = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl: forgedFetch, apiKeyToken: "k.s" });
    expect(rejected.outcome).toBe("rejected-invalid-signature");
    expect(readFileSync(lockfilePath, "utf-8")).toBe("ORIGINAL");

    // Then: a real, validly-signed policy — should apply normally.
    const lockfileJson = JSON.stringify({ version: 1, servers: {} });
    const realFetch = mockFetchJson(200, { version: 1, lockfileJson, signature: org.sign(lockfileJson) });
    const applied = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl: realFetch, apiKeyToken: "k.s" });
    expect(applied).toEqual({ outcome: "applied", version: 1 });
    expect(readFileSync(lockfilePath, "utf-8")).toBe(lockfileJson);
  });

  it("no policy published yet (404) is a clean skip, not an error", async () => {
    setup();
    const org = makeOrgKeypair();
    writeConfig({ workspaceId: "w", machineId: "m", ingestUrl: "http://127.0.0.1:8787", orgPublicKeyHex: org.publicKeyHex }, cfgPath);
    const fetchImpl = mockFetchJson(404, { error: "no policy" });
    const result = await pullAndApplyPolicy({ cfgPath, lockfilePath, fetchImpl, apiKeyToken: "k.s" });
    expect(result).toEqual({ outcome: "skipped-no-policy-published" });
  });
});
