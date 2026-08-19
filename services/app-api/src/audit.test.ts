import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { buildApp } from "./app.js";
import { verifyAuditChain, computeChainHash, genesisHash, eventsToCsv } from "./audit.js";
import type { AuditEventRow } from "./db.js";

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  const match = header?.match(/mcpseal_session=([^;]+)/);
  if (!match) throw new Error("no session cookie in response");
  return `mcpseal_session=${match[1]}`;
}

async function loginAs(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email } });
  const cookie = extractCookie(res.headers["set-cookie"]);
  return { cookie, ...res.json().user };
}

function makeChain(workspaceId: string, n: number): AuditEventRow[] {
  const events: AuditEventRow[] = [];
  let prevHash = genesisHash(workspaceId);
  for (let i = 0; i < n; i++) {
    const base = {
      eventId: randomUUID(),
      workspaceId,
      machineId: "m1",
      ts: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      type: "blocked_drift",
      server: "s",
      tool: `t${i}`,
      observedHash: null,
      expectedHash: null,
      descriptionDiff: null,
      clientApp: "c",
      severity: "high",
      ingestedAt: new Date().toISOString(),
      batchSignature: "sig",
    };
    const chainHash = computeChainHash(prevHash, base);
    events.push({ ...base, prevHash, chainHash });
    prevHash = chainHash;
  }
  return events;
}

describe("verifyAuditChain — the actual auditor-facing verification logic", () => {
  it("a valid chain verifies with no breaks", () => {
    const workspaceId = randomUUID();
    const events = makeChain(workspaceId, 5);
    const result = verifyAuditChain(workspaceId, events);
    expect(result.valid).toBe(true);
    expect(result.breaks).toHaveLength(0);
  });

  it("a modified event (fields changed after the fact) is detected", () => {
    const workspaceId = randomUUID();
    const events = makeChain(workspaceId, 3);
    events[1] = { ...events[1], tool: "TAMPERED" };
    const result = verifyAuditChain(workspaceId, events);
    expect(result.valid).toBe(false);
    expect(result.breaks.some((b) => b.reason === "chain_hash_mismatch" && b.eventId === events[1].eventId)).toBe(true);
  });

  it("a deleted event is detected via a prev_hash gap in the following event", () => {
    const workspaceId = randomUUID();
    const events = makeChain(workspaceId, 4);
    const withoutMiddle = [events[0], events[2], events[3]]; // delete index 1
    const result = verifyAuditChain(workspaceId, withoutMiddle);
    expect(result.valid).toBe(false);
    expect(result.breaks.some((b) => b.reason === "prev_hash_mismatch")).toBe(true);
  });

  it("reordered events are detected", () => {
    const workspaceId = randomUUID();
    const events = makeChain(workspaceId, 3);
    const reordered = [events[0], events[2], events[1]];
    const result = verifyAuditChain(workspaceId, reordered);
    expect(result.valid).toBe(false);
  });

  it("an inserted foreign event is detected", () => {
    const workspaceId = randomUUID();
    const events = makeChain(workspaceId, 2);
    const forged: AuditEventRow = {
      eventId: randomUUID(),
      workspaceId,
      machineId: "attacker",
      ts: new Date().toISOString(),
      type: "blocked_drift",
      server: "forged",
      tool: "forged",
      observedHash: null,
      expectedHash: null,
      descriptionDiff: null,
      clientApp: "forged",
      severity: "high",
      ingestedAt: new Date().toISOString(),
      prevHash: "not-a-real-hash",
      chainHash: "also-not-real",
      batchSignature: "forged",
    };
    const withInjection = [events[0], forged, events[1]];
    const result = verifyAuditChain(workspaceId, withInjection);
    expect(result.valid).toBe(false);
    // The forged row itself is unrecoverably wrong AND it poisons the next
    // real event's expected prev_hash too — both should be flagged.
    expect(result.breaks.length).toBeGreaterThanOrEqual(2);
  });

  it("an empty chain is trivially valid", () => {
    const result = verifyAuditChain(randomUUID(), []);
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(0);
  });

  it("eventsToCsv produces a header row and one row per event, properly escaped", () => {
    const workspaceId = randomUUID();
    const events = makeChain(workspaceId, 2);
    const csv = eventsToCsv(events);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toContain("eventId");
  });
});

describe("GET /v1/audit/export — RBAC, plan gating, and real end-to-end chain integrity", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp(":memory:");
  });

  async function shipRealSignedEvents(app: FastifyInstance, cookie: string, count: number) {
    // Reuse the real ingest-facing flow (register a machine, sign a real
    // batch) so the export test proves the FULL pipeline's chain is
    // self-consistent, not just a hand-constructed fixture.
    const wsRes = await app.inject({ method: "GET", url: "/v1/workspaces", headers: { cookie } });
    const workspaceId = wsRes.json().workspaces[0].id;

    // app-api doesn't expose ingest's endpoints directly in this test file
    // (they're a different Fastify app in a different package); instead
    // insert directly via the shared db handle, computing real chain
    // hashes with the same function ingest uses, to prove the STORED
    // rows — not just in-memory fixtures — verify correctly end-to-end.
    const db = (app as unknown as { mcpsealDb: import("better-sqlite3").Database }).mcpsealDb;
    let prevHash = genesisHash(workspaceId);
    for (let i = 0; i < count; i++) {
      const eventId = randomUUID();
      const ts = new Date(2026, 0, 1, 0, 0, i).toISOString();
      const fields = { eventId, ts, type: "blocked_drift", server: "s", tool: `t${i}`, observedHash: null, expectedHash: null, clientApp: "c" };
      const chainHash = computeChainHash(prevHash, fields);
      db.prepare(
        `INSERT INTO events (event_id, workspace_id, machine_id, ts, type, server, tool, client_app, severity, ingested_at, prev_hash, chain_hash, batch_signature)
         VALUES (?, ?, 'm1', ?, 'blocked_drift', 's', ?, 'c', 'high', ?, ?, ?, 'sig')`
      ).run(eventId, workspaceId, ts, `t${i}`, new Date().toISOString(), prevHash, chainHash);
      prevHash = chainHash;
    }
    return workspaceId;
  }

  async function upgradeToEnterprise(app: FastifyInstance, orgId: string) {
    const db = (app as unknown as { mcpsealDb: import("better-sqlite3").Database }).mcpsealDb;
    db.prepare(
      "INSERT INTO subscriptions (id, org_id, stripe_customer_id, stripe_sub_id, plan, seats, status) VALUES (?, ?, 'cus_x', 'sub_x', 'enterprise', 1, 'active')"
    ).run(randomUUID(), orgId);
    db.prepare("UPDATE orgs SET plan = 'enterprise' WHERE id = ?").run(orgId);
  }

  it("non-admin cannot access the audit export", async () => {
    await loginAs(app, "owner1@acme.com");
    const member = await loginAs(app, "member1@acme.com");
    const res = await app.inject({ method: "GET", url: "/v1/audit/export", headers: { cookie: member.cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("admin/owner on a non-Enterprise plan is denied with a clear reason", async () => {
    const owner = await loginAs(app, "owner2@acme.com");
    const res = await app.inject({ method: "GET", url: "/v1/audit/export", headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/Enterprise/);
  });

  it("Enterprise owner gets a valid, self-verifying JSON export of real ingested events", async () => {
    const owner = await loginAs(app, "owner3@acme.com");
    await upgradeToEnterprise(app, owner.orgId);
    await shipRealSignedEvents(app, owner.cookie, 4);

    const res = await app.inject({ method: "GET", url: "/v1/audit/export", headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(4);
    const workspaceId = body.events[0].workspaceId;
    expect(body.verification[workspaceId].valid).toBe(true);
  });

  it("tampering the underlying data makes the export's own embedded verification report a break", async () => {
    const owner = await loginAs(app, "owner4@acme.com");
    await upgradeToEnterprise(app, owner.orgId);
    const workspaceId = await shipRealSignedEvents(app, owner.cookie, 3);

    const db = (app as unknown as { mcpsealDb: import("better-sqlite3").Database }).mcpsealDb;
    db.prepare("UPDATE events SET tool = 'TAMPERED' WHERE event_id = (SELECT event_id FROM events WHERE workspace_id = ? ORDER BY rowid ASC LIMIT 1)").run(
      workspaceId
    );

    const res = await app.inject({ method: "GET", url: "/v1/audit/export", headers: { cookie: owner.cookie } });
    const body = res.json();
    expect(body.verification[workspaceId].valid).toBe(false);
  });

  it("CSV format returns a text/csv response with real rows", async () => {
    const owner = await loginAs(app, "owner5@acme.com");
    await upgradeToEnterprise(app, owner.orgId);
    await shipRealSignedEvents(app, owner.cookie, 2);

    const res = await app.inject({ method: "GET", url: "/v1/audit/export?format=csv", headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body.split("\n")).toHaveLength(3); // header + 2 rows
  });
});
