import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { shipEvents } from "./ship-events.js";
import { appendEvent } from "./event-log.js";
import { writeConfig } from "./config.js";
import { setSecret, deleteSecret, getSecret } from "./keychain.js";
import { API_KEY_ACCOUNT } from "./login.js";
import { loadOrCreateMachineIdentity } from "./machine-identity.js";

const PRIVATE_KEY_ACCOUNT = "machine-private-key";

describe("shipEvents — CLAUDE.md invariant 2 (no network before login)", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("makes ZERO network calls when there is no config at all (never logged in)", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcpseal-ship-test-"));
    const cfgPath = path.join(tmpDir, "config.json"); // deliberately never written
    const logPath = path.join(tmpDir, "events.jsonl");
    appendEvent({ type: "blocked_drift", server: "s", tool: "t" }, logPath);

    const fetchImpl = (() => {
      throw new Error("fetch must never be called before login");
    }) as unknown as typeof fetch;

    const result = await shipEvents({ cfgPath, logPath, fetchImpl });
    expect(result.skipped).toBe(true);
  });

  it("makes ZERO network calls when config exists but keychain has no credentials", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcpseal-ship-test-"));
    const cfgPath = path.join(tmpDir, "config.json");
    const logPath = path.join(tmpDir, "events.jsonl");
    writeConfig({ workspaceId: randomUUID(), machineId: randomUUID(), ingestUrl: "http://127.0.0.1:8787" }, cfgPath);
    appendEvent({ type: "blocked_drift", server: "s", tool: "t" }, logPath);

    const fetchImpl = (() => {
      throw new Error("fetch must never be called without stored credentials");
    }) as unknown as typeof fetch;

    const result = await shipEvents({ cfgPath, logPath, fetchImpl });
    expect(result.skipped).toBe(true);
  });
});

describe("shipEvents — opted-in shipping", () => {
  let tmpDir: string;

  afterEach(() => {
    deleteSecret(API_KEY_ACCOUNT);
    deleteSecret(PRIVATE_KEY_ACCOUNT);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ships unshipped events, signs the batch, and advances the cursor", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcpseal-ship-test-"));
    const cfgPath = path.join(tmpDir, "config.json");
    const logPath = path.join(tmpDir, "events.jsonl");
    const workspaceId = randomUUID();
    const machineId = randomUUID();

    writeConfig({ workspaceId, machineId, ingestUrl: "http://127.0.0.1:8787" }, cfgPath);
    setSecret(API_KEY_ACCOUNT, "keyid.secret");
    loadOrCreateMachineIdentity();

    appendEvent({ type: "blocked_drift", server: "github", tool: "create_issue" }, logPath);
    appendEvent({ type: "blocked_unknown", server: "github", tool: "delete_repo" }, logPath);

    let capturedBody: string | null = null;
    let capturedHeaders: Record<string, string> | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      capturedHeaders = init.headers as Record<string, string>;
      return {
        ok: true,
        status: 202,
        json: async () => ({ accepted: 2, duplicates: 0 }),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await shipEvents({ cfgPath, logPath, fetchImpl });
    expect(result).toEqual({ skipped: false, shipped: 2, duplicates: 0 });
    expect(capturedHeaders?.authorization).toBe("Bearer keyid.secret");
    expect(capturedHeaders?.["x-mcpseal-signature"]).toMatch(/^[0-9a-f]+$/);
    expect(JSON.parse(capturedBody!).workspaceId).toBe(workspaceId);
    expect(JSON.parse(capturedBody!).machineId).toBe(machineId);
    expect(JSON.parse(capturedBody!).batch).toHaveLength(2);
  });

  it("does not re-ship events already covered by the cursor", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcpseal-ship-test-"));
    const cfgPath = path.join(tmpDir, "config.json");
    const logPath = path.join(tmpDir, "events.jsonl");
    writeConfig({ workspaceId: randomUUID(), machineId: randomUUID(), ingestUrl: "http://127.0.0.1:8787" }, cfgPath);
    setSecret(API_KEY_ACCOUNT, "keyid.secret");
    loadOrCreateMachineIdentity();

    appendEvent({ type: "blocked_drift", server: "s", tool: "t1" }, logPath);

    let callCount = 0;
    const fetchImpl = (async () => {
      callCount++;
      return { ok: true, status: 202, json: async () => ({ accepted: 1, duplicates: 0 }) } as Response;
    }) as unknown as typeof fetch;

    await shipEvents({ cfgPath, logPath, fetchImpl });
    expect(callCount).toBe(1);

    // Second call with no new events should not hit the network at all.
    const result = await shipEvents({ cfgPath, logPath, fetchImpl });
    expect(callCount).toBe(1);
    expect(result).toEqual({ skipped: false, shipped: 0, duplicates: 0 });
  });

  it("leaves the cursor unchanged on a network failure so the batch is retried later", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcpseal-ship-test-"));
    const cfgPath = path.join(tmpDir, "config.json");
    const logPath = path.join(tmpDir, "events.jsonl");
    writeConfig({ workspaceId: randomUUID(), machineId: randomUUID(), ingestUrl: "http://127.0.0.1:8787" }, cfgPath);
    setSecret(API_KEY_ACCOUNT, "keyid.secret");
    loadOrCreateMachineIdentity();
    appendEvent({ type: "blocked_drift", server: "s", tool: "t1" }, logPath);

    const failingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result1 = await shipEvents({ cfgPath, logPath, fetchImpl: failingFetch });
    expect(result1).toEqual({ skipped: false, shipped: 0, duplicates: 0 });

    let called = false;
    const workingFetch = (async () => {
      called = true;
      return { ok: true, status: 202, json: async () => ({ accepted: 1, duplicates: 0 }) } as Response;
    }) as unknown as typeof fetch;
    const result2 = await shipEvents({ cfgPath, logPath, fetchImpl: workingFetch });
    expect(called).toBe(true);
    expect(result2).toEqual({ skipped: false, shipped: 1, duplicates: 0 });
  });
});
