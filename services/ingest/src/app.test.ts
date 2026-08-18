import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { buildApp } from "./app.js";

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

async function setupApprovedWorkspace(app: FastifyInstance) {
  const health = await app.inject({ method: "GET", url: "/healthz" });
  const devWorkspaceId = health.json().devWorkspaceId as string;

  const startRes = await app.inject({ method: "POST", url: "/v1/auth/device/start", payload: {} });
  const { deviceCode, userCode } = startRes.json();

  await app.inject({ method: "POST", url: "/v1/auth/device/approve", payload: { userCode, workspaceId: devWorkspaceId } });

  const pollRes = await app.inject({ method: "POST", url: "/v1/auth/device/poll", payload: { deviceCode } });
  const poll = pollRes.json();
  expect(poll.status).toBe("approved");
  return { apiKeyToken: poll.apiKeyToken as string, workspaceId: poll.workspaceId as string };
}

function makeMachineKeypair() {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKeyHex: bytesToHex(publicKey) };
}

describe("ingest app", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp(":memory:");
  });

  it("health check responds", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });

  it("full device-flow -> machine registration -> signed event ingestion happy path", async () => {
    const { apiKeyToken, workspaceId } = await setupApprovedWorkspace(app);
    const { privateKey, publicKeyHex } = makeMachineKeypair();
    const machineId = randomUUID();

    const regRes = await app.inject({
      method: "POST",
      url: "/v1/machines/register",
      headers: { authorization: `Bearer ${apiKeyToken}` },
      payload: { workspaceId, machineId, publicKey: publicKeyHex, mcplockVersion: "0.1.0" },
    });
    expect(regRes.statusCode).toBe(200);

    const body = {
      machineId,
      workspaceId,
      batch: [
        {
          eventId: randomUUID(),
          ts: new Date().toISOString(),
          type: "blocked_drift",
          server: "github",
          tool: "create_issue",
          observedHash: "sha256:aaa",
          expectedHash: "sha256:bbb",
          clientApp: "cursor",
          mcplockVersion: "0.1.0",
        },
      ],
    };
    const raw = JSON.stringify(body);
    const signature = bytesToHex(ed25519.sign(Buffer.from(raw, "utf-8"), privateKey));

    const evRes = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${apiKeyToken}`, "x-mcplock-signature": signature, "content-type": "application/json" },
      payload: raw,
    });
    expect(evRes.statusCode).toBe(202);
    expect(evRes.json()).toEqual({ accepted: 1, duplicates: 0 });

    // Idempotent retry of the exact same batch is accepted but counted as duplicate.
    const retryRes = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${apiKeyToken}`, "x-mcplock-signature": signature, "content-type": "application/json" },
      payload: raw,
    });
    expect(retryRes.statusCode).toBe(202);
    expect(retryRes.json()).toEqual({ accepted: 0, duplicates: 1 });
  });

  it("rejects events with no Authorization header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: JSON.stringify({ machineId: randomUUID(), workspaceId: randomUUID(), batch: [] }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects events with an invalid API key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer deadbeef.notreal" },
      payload: JSON.stringify({ machineId: randomUUID(), workspaceId: randomUUID(), batch: [] }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unregistered machine", async () => {
    const { apiKeyToken, workspaceId } = await setupApprovedWorkspace(app);
    const body = { machineId: randomUUID(), workspaceId, batch: [] };
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${apiKeyToken}`, "x-mcplock-signature": "00", "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a bad signature (wrong key signed it) — fail closed", async () => {
    const { apiKeyToken, workspaceId } = await setupApprovedWorkspace(app);
    const { publicKeyHex } = makeMachineKeypair();
    const attackerKeypair = makeMachineKeypair(); // different keypair than the one registered
    const machineId = randomUUID();

    await app.inject({
      method: "POST",
      url: "/v1/machines/register",
      headers: { authorization: `Bearer ${apiKeyToken}` },
      payload: { workspaceId, machineId, publicKey: publicKeyHex },
    });

    const body = { machineId, workspaceId, batch: [] };
    const raw = JSON.stringify(body);
    const forgedSignature = bytesToHex(ed25519.sign(Buffer.from(raw, "utf-8"), attackerKeypair.privateKey));

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${apiKeyToken}`, "x-mcplock-signature": forgedSignature, "content-type": "application/json" },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a tampered body (signature no longer matches)", async () => {
    const { apiKeyToken, workspaceId } = await setupApprovedWorkspace(app);
    const { privateKey, publicKeyHex } = makeMachineKeypair();
    const machineId = randomUUID();
    await app.inject({
      method: "POST",
      url: "/v1/machines/register",
      headers: { authorization: `Bearer ${apiKeyToken}` },
      payload: { workspaceId, machineId, publicKey: publicKeyHex },
    });

    const original = { machineId, workspaceId, batch: [] };
    const rawOriginal = JSON.stringify(original);
    const signature = bytesToHex(ed25519.sign(Buffer.from(rawOriginal, "utf-8"), privateKey));

    const tampered = { machineId, workspaceId, batch: [{ eventId: randomUUID(), ts: new Date().toISOString(), type: "blocked_drift", server: "x", tool: "y", clientApp: "z", mcplockVersion: "0.1.0" }] };
    const rawTampered = JSON.stringify(tampered);

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${apiKeyToken}`, "x-mcplock-signature": signature, "content-type": "application/json" },
      payload: rawTampered,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects malformed JSON body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: "Bearer aa.bb", "content-type": "application/json" },
      payload: "{not valid json",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a batch item missing required fields", async () => {
    const { apiKeyToken, workspaceId } = await setupApprovedWorkspace(app);
    const { privateKey, publicKeyHex } = makeMachineKeypair();
    const machineId = randomUUID();
    await app.inject({
      method: "POST",
      url: "/v1/machines/register",
      headers: { authorization: `Bearer ${apiKeyToken}` },
      payload: { workspaceId, machineId, publicKey: publicKeyHex },
    });
    const body = { machineId, workspaceId, batch: [{ eventId: "not-a-uuid" }] };
    const raw = JSON.stringify(body);
    const signature = bytesToHex(ed25519.sign(Buffer.from(raw, "utf-8"), privateKey));
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${apiKeyToken}`, "x-mcplock-signature": signature, "content-type": "application/json" },
      payload: raw,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a batch larger than the max size", async () => {
    const { apiKeyToken, workspaceId } = await setupApprovedWorkspace(app);
    const { privateKey, publicKeyHex } = makeMachineKeypair();
    const machineId = randomUUID();
    await app.inject({
      method: "POST",
      url: "/v1/machines/register",
      headers: { authorization: `Bearer ${apiKeyToken}` },
      payload: { workspaceId, machineId, publicKey: publicKeyHex },
    });
    const batch = Array.from({ length: 501 }, () => ({
      eventId: randomUUID(),
      ts: new Date().toISOString(),
      type: "blocked_drift",
      server: "s",
      tool: "t",
      clientApp: "c",
      mcplockVersion: "0.1.0",
    }));
    const body = { machineId, workspaceId, batch };
    const raw = JSON.stringify(body);
    const signature = bytesToHex(ed25519.sign(Buffer.from(raw, "utf-8"), privateKey));
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${apiKeyToken}`, "x-mcplock-signature": signature, "content-type": "application/json" },
      payload: raw,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a workspaceId that doesn't match the authenticated key's workspace", async () => {
    const { apiKeyToken } = await setupApprovedWorkspace(app);
    const { privateKey, publicKeyHex } = makeMachineKeypair();
    const machineId = randomUUID();
    const otherWorkspace = randomUUID();
    const body = { machineId, workspaceId: otherWorkspace, batch: [] };
    const raw = JSON.stringify(body);
    const signature = bytesToHex(ed25519.sign(Buffer.from(raw, "utf-8"), privateKey));
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${apiKeyToken}`, "x-mcplock-signature": signature, "content-type": "application/json" },
      payload: raw,
    });
    expect(res.statusCode).toBe(403);
    expect(publicKeyHex.length).toBe(64); // sanity check on fixture
  });

  it("rate limits an API key after too many requests", { timeout: 20000 }, async () => {
    const { apiKeyToken, workspaceId } = await setupApprovedWorkspace(app);
    const { privateKey, publicKeyHex } = makeMachineKeypair();
    const machineId = randomUUID();
    await app.inject({
      method: "POST",
      url: "/v1/machines/register",
      headers: { authorization: `Bearer ${apiKeyToken}` },
      payload: { workspaceId, machineId, publicKey: publicKeyHex },
    });
    const body = { machineId, workspaceId, batch: [] };
    const raw = JSON.stringify(body);
    const signature = bytesToHex(ed25519.sign(Buffer.from(raw, "utf-8"), privateKey));

    let lastStatus = 0;
    for (let i = 0; i < 125; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: { authorization: `Bearer ${apiKeyToken}`, "x-mcplock-signature": signature, "content-type": "application/json" },
        payload: raw,
      });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });

  it("a poll on an unapproved device code stays pending", async () => {
    const startRes = await app.inject({ method: "POST", url: "/v1/auth/device/start", payload: {} });
    const { deviceCode } = startRes.json();
    const pollRes = await app.inject({ method: "POST", url: "/v1/auth/device/poll", payload: { deviceCode } });
    expect(pollRes.json()).toEqual({ status: "pending" });
  });

  it("a device code can only be consumed for an API key once", async () => {
    const health = await app.inject({ method: "GET", url: "/healthz" });
    const devWorkspaceId = health.json().devWorkspaceId as string;
    const startRes = await app.inject({ method: "POST", url: "/v1/auth/device/start", payload: {} });
    const { deviceCode, userCode } = startRes.json();
    await app.inject({ method: "POST", url: "/v1/auth/device/approve", payload: { userCode, workspaceId: devWorkspaceId } });
    const first = await app.inject({ method: "POST", url: "/v1/auth/device/poll", payload: { deviceCode } });
    expect(first.json().status).toBe("approved");
    const second = await app.inject({ method: "POST", url: "/v1/auth/device/poll", payload: { deviceCode } });
    expect(second.json().status).toBe("denied");
  });
});
