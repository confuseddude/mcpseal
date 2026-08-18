import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { login } from "./login.js";
import { readConfig } from "./config.js";
import { deleteSecret, getSecret } from "./keychain.js";
import { API_KEY_ACCOUNT } from "./login.js";

const PRIVATE_KEY_ACCOUNT = "machine-private-key";

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe("login", () => {
  let tmpDir: string;

  afterEach(() => {
    deleteSecret(API_KEY_ACCOUNT);
    deleteSecret(PRIVATE_KEY_ACCOUNT);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("completes the device flow, stores the API key in the keychain, and writes config", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcplock-login-test-"));
    const cfgPath = path.join(tmpDir, "config.json");
    const workspaceId = randomUUID();
    const apiKeyToken = "keyid123.secretvalue";

    const fetchImpl = mockFetchSequence([
      { status: 200, body: { deviceCode: "dc-1", userCode: "ABC123", expiresIn: 60, interval: 0.01 } },
      { status: 200, body: { status: "approved", apiKeyToken, workspaceId } },
      { status: 200, body: { machineId: "whatever", workspaceId } },
    ]);

    let sawWaiting = false;
    const result = await login({
      fetchImpl,
      cfgPath,
      sleep: () => Promise.resolve(),
      onWaitingForApproval: (userCode) => {
        expect(userCode).toBe("ABC123");
        sawWaiting = true;
      },
    });

    expect(sawWaiting).toBe(true);
    expect(result.workspaceId).toBe(workspaceId);
    expect(getSecret(API_KEY_ACCOUNT)).toBe(apiKeyToken);
    expect(getSecret(PRIVATE_KEY_ACCOUNT)).toMatch(/^[0-9a-f]{64}$/);

    const config = readConfig(cfgPath);
    expect(config?.workspaceId).toBe(workspaceId);
    expect(config?.machineId).toBe(result.machineId);
  });

  it("polls through pending states before approval", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcplock-login-test-"));
    const cfgPath = path.join(tmpDir, "config.json");
    const workspaceId = randomUUID();

    const fetchImpl = mockFetchSequence([
      { status: 200, body: { deviceCode: "dc-2", userCode: "XYZ999", expiresIn: 60, interval: 0.01 } },
      { status: 200, body: { status: "pending" } },
      { status: 200, body: { status: "pending" } },
      { status: 200, body: { status: "approved", apiKeyToken: "k.s", workspaceId } },
      { status: 200, body: { machineId: "m", workspaceId } },
    ]);

    const result = await login({ fetchImpl, cfgPath, sleep: () => Promise.resolve(), maxPolls: 10 });
    expect(result.workspaceId).toBe(workspaceId);
  });

  it("throws if the device code is denied", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcplock-login-test-"));
    const cfgPath = path.join(tmpDir, "config.json");
    const fetchImpl = mockFetchSequence([
      { status: 200, body: { deviceCode: "dc-3", userCode: "DEN000", expiresIn: 60, interval: 0.01 } },
      { status: 200, body: { status: "denied" } },
    ]);
    await expect(login({ fetchImpl, cfgPath, sleep: () => Promise.resolve() })).rejects.toThrow(/denied/);
    expect(readConfig(cfgPath)).toBeNull();
  });

  it("throws if the device code expires", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcplock-login-test-"));
    const cfgPath = path.join(tmpDir, "config.json");
    const fetchImpl = mockFetchSequence([
      { status: 200, body: { deviceCode: "dc-4", userCode: "EXP000", expiresIn: 60, interval: 0.01 } },
      { status: 200, body: { status: "expired" } },
    ]);
    await expect(login({ fetchImpl, cfgPath, sleep: () => Promise.resolve() })).rejects.toThrow(/expired/);
  });

  it("throws (does not silently succeed) if device/start returns a non-2xx", async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcplock-login-test-"));
    const cfgPath = path.join(tmpDir, "config.json");
    const fetchImpl = mockFetchSequence([{ status: 500, body: {} }]);
    await expect(login({ fetchImpl, cfgPath, sleep: () => Promise.resolve() })).rejects.toThrow(/HTTP 500/);
  });
});
