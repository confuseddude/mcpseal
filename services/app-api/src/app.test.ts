import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  const match = header?.match(/mcpseal_session=([^;]+)/);
  if (!match) throw new Error("no session cookie in response");
  return `mcpseal_session=${match[1]}`;
}

async function loginAs(app: FastifyInstance, email: string): Promise<{ cookie: string; userId: string; orgId: string; role: string }> {
  const res = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email } });
  const cookie = extractCookie(res.headers["set-cookie"]);
  const body = res.json();
  return { cookie, userId: body.user.id, orgId: body.user.orgId, role: body.user.role };
}

describe("app-api auth + RBAC + cross-org isolation", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp(":memory:");
  });

  it("first user from a domain becomes owner; second becomes member", async () => {
    const owner = await loginAs(app, "alice@acme.com");
    const member = await loginAs(app, "bob@acme.com");
    expect(owner.role).toBe("owner");
    expect(member.role).toBe("member");
    expect(owner.orgId).toBe(member.orgId); // same domain -> same org
  });

  it("different email domains land in different orgs", async () => {
    const a = await loginAs(app, "alice@acme.com");
    const b = await loginAs(app, "carol@other.com");
    expect(a.orgId).not.toBe(b.orgId);
  });

  it("rejects unauthenticated requests to protected routes", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/members" });
    expect(res.statusCode).toBe(401);
  });

  it("session cookie authenticates subsequent requests", async () => {
    const { cookie } = await loginAs(app, "alice@acme.com");
    const res = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("alice@acme.com");
  });

  it("logout revokes the session — it cannot be reused afterward", async () => {
    const { cookie } = await loginAs(app, "alice@acme.com");
    const logoutRes = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: { cookie } });
    expect(logoutRes.statusCode).toBe(200);
    const meRes = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(meRes.statusCode).toBe(401);
  });

  it("a forged/random session cookie is rejected", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: "mcpseal_session=not-a-real-session-id" } });
    expect(res.statusCode).toBe(401);
  });

  it("member cannot change another user's role (requires admin/owner)", async () => {
    const owner = await loginAs(app, "alice@acme.com");
    const member = await loginAs(app, "bob@acme.com");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/members/${owner.userId}/role`,
      headers: { cookie: member.cookie },
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("owner CAN change another user's role", async () => {
    const owner = await loginAs(app, "alice@acme.com");
    const member = await loginAs(app, "bob@acme.com");
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/members/${member.userId}/role`,
      headers: { cookie: owner.cookie },
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(200);

    const members = await app.inject({ method: "GET", url: "/v1/members", headers: { cookie: owner.cookie } });
    const updated = members.json().members.find((m: { id: string }) => m.id === member.userId);
    expect(updated.role).toBe("admin");
  });

  it("CROSS-ORG ISOLATION: a user from org A cannot see org B's members via any client-supplied ID", async () => {
    const orgA = await loginAs(app, "alice@acme.com");
    const orgB = await loginAs(app, "zoe@othercorp.com");

    // orgA's /v1/members must never include orgB's user, regardless of
    // anything orgB's user ID or org ID being guessable.
    const res = await app.inject({ method: "GET", url: "/v1/members", headers: { cookie: orgA.cookie } });
    const emails = res.json().members.map((m: { email: string }) => m.email);
    expect(emails).not.toContain("zoe@othercorp.com");
    expect(orgA.orgId).not.toBe(orgB.orgId);
  });

  it("CROSS-ORG ISOLATION: admin in org A cannot change a role for a user in org B (404, not leaked)", async () => {
    const orgA = await loginAs(app, "alice@acme.com"); // owner of org A
    const orgB = await loginAs(app, "zoe@othercorp.com"); // owner of org B

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/members/${orgB.userId}/role`,
      headers: { cookie: orgA.cookie },
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("CROSS-ORG ISOLATION: org A cannot see org B's workspaces, machines, or events", async () => {
    const orgA = await loginAs(app, "alice@acme.com");
    const orgB = await loginAs(app, "zoe@othercorp.com");

    const wsB = await app.inject({ method: "GET", url: "/v1/workspaces", headers: { cookie: orgB.cookie } });
    const orgBWorkspaceId = wsB.json().workspaces[0].id;

    const wsA = await app.inject({ method: "GET", url: "/v1/workspaces", headers: { cookie: orgA.cookie } });
    const orgAWorkspaceIds = wsA.json().workspaces.map((w: { id: string }) => w.id);
    expect(orgAWorkspaceIds).not.toContain(orgBWorkspaceId);

    const machinesA = await app.inject({ method: "GET", url: "/v1/machines", headers: { cookie: orgA.cookie } });
    expect(machinesA.json().machines).toEqual([]);

    const eventsA = await app.inject({ method: "GET", url: "/v1/events", headers: { cookie: orgA.cookie } });
    expect(eventsA.json().events).toEqual([]);
  });

  it("non-admin cannot list or revoke API keys", async () => {
    await loginAs(app, "alice-first@acme.com"); // becomes owner, so the next login lands as member
    const member = await loginAs(app, "bob-viewer@acme.com");
    expect(member.role).toBe("member");
    const res = await app.inject({ method: "GET", url: "/v1/api-keys", headers: { cookie: member.cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("non-admin cannot create a policy", async () => {
    await loginAs(app, "alice-first2@acme.com"); // becomes owner, so the next login lands as member
    const member = await loginAs(app, "bob2@acme.com");
    expect(member.role).toBe("member");
    const res = await app.inject({
      method: "POST",
      url: "/v1/policies",
      headers: { cookie: member.cookie },
      payload: { lockfileJson: "{}" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin can create and list policies, versioned starting at 1", async () => {
    const owner = await loginAs(app, "alice3@acme.com");
    const create1 = await app.inject({
      method: "POST",
      url: "/v1/policies",
      headers: { cookie: owner.cookie },
      payload: { lockfileJson: '{"version":1}' },
    });
    expect(create1.statusCode).toBe(201);
    expect(create1.json().policy.version).toBe(1);

    const create2 = await app.inject({
      method: "POST",
      url: "/v1/policies",
      headers: { cookie: owner.cookie },
      payload: { lockfileJson: '{"version":2}' },
    });
    expect(create2.json().policy.version).toBe(2);

    const list = await app.inject({ method: "GET", url: "/v1/policies", headers: { cookie: owner.cookie } });
    expect(list.json().policies.map((p: { version: number }) => p.version)).toEqual([2, 1]);
  });

  it("rejects malformed lockfileJson on policy creation", async () => {
    const owner = await loginAs(app, "alice4@acme.com");
    const res = await app.inject({
      method: "POST",
      url: "/v1/policies",
      headers: { cookie: owner.cookie },
      payload: { lockfileJson: "{not valid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("free-plan subscription is the default for a brand-new org", async () => {
    const owner = await loginAs(app, "alice5@acme.com");
    const res = await app.inject({ method: "GET", url: "/v1/billing/subscription", headers: { cookie: owner.cookie } });
    expect(res.json().subscription.plan).toBe("free");
  });
});
