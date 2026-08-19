// Tests POST /v1/machines/connect — the Dashboard-authenticated caller for
// the Part 6.2 device-flow "approve" step (see NIGHT_SHIFT_LOG.md Morning
// Action Items #4). Uses a real temp-file SQLite DB (not :memory:) so a
// pending device_codes row can be inserted directly, mirroring exactly what
// services/ingest's startDeviceFlow() would have written to the same
// physical file in production/real e2e use — without adding a test-only
// cross-service dependency (the two services intentionally share no code).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app.js";

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  const match = header?.match(/mcplock_session=([^;]+)/);
  if (!match) throw new Error("no session cookie in response");
  return `mcplock_session=${match[1]}`;
}

async function loginAs(app: FastifyInstance, email: string): Promise<{ cookie: string; userId: string; orgId: string; role: string }> {
  const res = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email } });
  const cookie = extractCookie(res.headers["set-cookie"]);
  const body = res.json();
  return { cookie, userId: body.user.id, orgId: body.user.orgId, role: body.user.role };
}

describe("POST /v1/machines/connect", () => {
  let dir: string;
  let dbPath: string;
  let app: FastifyInstance;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mcplock-connect-test-"));
    dbPath = path.join(dir, "shared.sqlite3");
    app = buildApp(dbPath); // creates device_codes (IF NOT EXISTS) in the shared file
  });

  afterEach(async () => {
    await app.close();
    // better-sqlite3's WAL-mode file handles can still be held briefly by
    // the OS on Windows after close(); cleanup is best-effort test tidiness,
    // not something a failure here should fail the test over.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function insertPendingCode(userCode: string, expiresInMs = 10 * 60 * 1000): void {
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO device_codes (device_code, user_code, workspace_id, status, created_at, expires_at)
       VALUES (?, ?, NULL, 'pending', ?, ?)`
    ).run(randomUUID(), userCode, new Date().toISOString(), new Date(Date.now() + expiresInMs).toISOString());
    db.close();
  }

  it("owner/admin can approve a pending code into their org's default workspace", async () => {
    const owner = await loginAs(app, "alice@acme.com");
    const userCode = randomBytes(3).toString("hex").toUpperCase();
    insertPendingCode(userCode);

    const res = await app.inject({
      method: "POST",
      url: "/v1/machines/connect",
      headers: { cookie: owner.cookie },
      payload: { userCode },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.approved).toBe(true);
    expect(typeof body.workspaceId).toBe("string");

    // The underlying row is actually flipped to approved with that
    // workspaceId — not just a 200 with no real effect.
    const db = new Database(dbPath);
    const row = db.prepare("SELECT status, workspace_id FROM device_codes WHERE user_code = ?").get(userCode) as
      | { status: string; workspace_id: string }
      | undefined;
    db.close();
    expect(row?.status).toBe("approved");
    expect(row?.workspace_id).toBe(body.workspaceId);
  });

  it("is case-insensitive on the user code (matches how a human types it)", async () => {
    const owner = await loginAs(app, "alice@acme.com");
    const userCode = randomBytes(3).toString("hex").toUpperCase();
    insertPendingCode(userCode);

    const res = await app.inject({
      method: "POST",
      url: "/v1/machines/connect",
      headers: { cookie: owner.cookie },
      payload: { userCode: userCode.toLowerCase() + " " },
    });
    expect(res.statusCode).toBe(200);
  });

  it("member (below admin) is denied", async () => {
    await loginAs(app, "alice@acme.com"); // owner, first in org
    const member = await loginAs(app, "bob@acme.com");
    const userCode = randomBytes(3).toString("hex").toUpperCase();
    insertPendingCode(userCode);

    const res = await app.inject({
      method: "POST",
      url: "/v1/machines/connect",
      headers: { cookie: member.cookie },
      payload: { userCode },
    });
    expect(res.statusCode).toBe(403);
  });

  it("unauthenticated request is rejected", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/machines/connect", payload: { userCode: "ABCDEF" } });
    expect(res.statusCode).toBe(401);
  });

  it("unknown code is rejected (404), not silently accepted", async () => {
    const owner = await loginAs(app, "alice@acme.com");
    const res = await app.inject({
      method: "POST",
      url: "/v1/machines/connect",
      headers: { cookie: owner.cookie },
      payload: { userCode: "FFFFFF" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("expired code is rejected, not approved", async () => {
    const owner = await loginAs(app, "alice@acme.com");
    const userCode = randomBytes(3).toString("hex").toUpperCase();
    insertPendingCode(userCode, -1000); // already expired

    const res = await app.inject({
      method: "POST",
      url: "/v1/machines/connect",
      headers: { cookie: owner.cookie },
      payload: { userCode },
    });
    expect(res.statusCode).toBe(404);
  });

  it("an explicit workspaceId belonging to a DIFFERENT org is rejected, not silently approved cross-org", async () => {
    const ownerA = await loginAs(app, "alice@acme.com");
    const ownerB = await loginAs(app, "zed@other.com");

    const wsRes = await app.inject({ method: "GET", url: "/v1/workspaces", headers: { cookie: ownerB.cookie } });
    const otherOrgWorkspaceId = wsRes.json().workspaces[0].id;

    const userCode = randomBytes(3).toString("hex").toUpperCase();
    insertPendingCode(userCode);

    const res = await app.inject({
      method: "POST",
      url: "/v1/machines/connect",
      headers: { cookie: ownerA.cookie },
      payload: { userCode, workspaceId: otherOrgWorkspaceId },
    });
    expect(res.statusCode).toBe(404);

    // And the code must still be pending/untouched — the rejection must
    // not have side-effects.
    const db = new Database(dbPath);
    const row = db.prepare("SELECT status FROM device_codes WHERE user_code = ?").get(userCode) as { status: string } | undefined;
    db.close();
    expect(row?.status).toBe("pending");
  });

  it("malformed body is rejected", async () => {
    const owner = await loginAs(app, "alice@acme.com");
    const res = await app.inject({
      method: "POST",
      url: "/v1/machines/connect",
      headers: { cookie: owner.cookie },
      payload: { userCode: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});
