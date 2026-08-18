import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";

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

async function upgradeToEnterprise(app: FastifyInstance, orgId: string) {
  const db = (app as unknown as { mcplockDb: import("better-sqlite3").Database }).mcplockDb;
  db.prepare(
    "INSERT INTO subscriptions (id, org_id, stripe_customer_id, stripe_sub_id, plan, seats, status) VALUES (?, ?, 'c', 's', 'enterprise', 1, 'active')"
  ).run(randomUUID(), orgId);
  db.prepare("UPDATE orgs SET plan = 'enterprise' WHERE id = ?").run(orgId);
}

describe("SSO config (Enterprise-gated, admin-managed)", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = buildApp(":memory:");
  });

  it("non-Enterprise org cannot configure SSO", async () => {
    const owner = await loginAs(app, "owner1@acme.com");
    const res = await app.inject({
      method: "PUT",
      url: "/v1/enterprise/sso",
      headers: { cookie: owner.cookie },
      payload: { provider: "okta", domain: "acme.com", enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("non-admin cannot configure SSO even on Enterprise", async () => {
    const owner = await loginAs(app, "owner2@acme.com");
    await upgradeToEnterprise(app, owner.orgId);
    const member = await loginAs(app, "member2@acme.com");
    const res = await app.inject({
      method: "PUT",
      url: "/v1/enterprise/sso",
      headers: { cookie: member.cookie },
      payload: { provider: "okta", domain: "acme.com", enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Enterprise admin can configure SSO and receives a SCIM token exactly once", async () => {
    const owner = await loginAs(app, "owner3@acme.com");
    await upgradeToEnterprise(app, owner.orgId);

    const first = await app.inject({
      method: "PUT",
      url: "/v1/enterprise/sso",
      headers: { cookie: owner.cookie },
      payload: { provider: "okta", domain: "acme.com", enabled: true },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().scimToken).toMatch(/^[0-9a-f]{64}$/);

    // Second call (e.g. toggling enabled) does NOT re-issue a token.
    const second = await app.inject({
      method: "PUT",
      url: "/v1/enterprise/sso",
      headers: { cookie: owner.cookie },
      payload: { provider: "okta", domain: "acme.com", enabled: false },
    });
    expect(second.json().scimToken).toBeNull();

    const getRes = await app.inject({ method: "GET", url: "/v1/enterprise/sso", headers: { cookie: owner.cookie } });
    expect(getRes.json().config).toEqual({ provider: "okta", domain: "acme.com", enabled: false });
    // Never leaks the token hash via the read endpoint.
    expect(JSON.stringify(getRes.json())).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe("SCIM provisioning (build-bible Part 6.1/8.2)", () => {
  let app: FastifyInstance;
  let scimToken: string;
  let orgId: string;

  beforeEach(async () => {
    app = buildApp(":memory:");
    const owner = await loginAs(app, `owner-${randomUUID()}@acme.com`);
    orgId = owner.orgId;
    await upgradeToEnterprise(app, orgId);
    const setupRes = await app.inject({
      method: "PUT",
      url: "/v1/enterprise/sso",
      headers: { cookie: owner.cookie },
      payload: { provider: "okta", domain: "acme.com", enabled: true },
    });
    scimToken = setupRes.json().scimToken;
  });

  it("rejects requests with no SCIM token", async () => {
    const res = await app.inject({ method: "GET", url: "/scim/v2/Users" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects requests with a wrong/forged SCIM token", async () => {
    const res = await app.inject({ method: "GET", url: "/scim/v2/Users", headers: { authorization: "Bearer " + "0".repeat(64) } });
    expect(res.statusCode).toBe(401);
  });

  it("provisions a new user via SCIM, which can then log in normally", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: { authorization: `Bearer ${scimToken}`, "content-type": "application/json" },
      payload: { userName: "newhire@acme.com" },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().active).toBe(true);

    // The provisioned user can now log in (dev-mock) and gets a real
    // session — SCIM provisioning is meant to precede real access.
    const loginRes = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email: "newhire@acme.com" } });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json().user.orgId).toBe(orgId);
    expect(loginRes.json().user.role).toBe("member"); // SCIM-provisioned users are never auto-owner
  });

  it("rejects provisioning a duplicate email", async () => {
    await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: { authorization: `Bearer ${scimToken}`, "content-type": "application/json" },
      payload: { userName: "dupe@acme.com" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: { authorization: `Bearer ${scimToken}`, "content-type": "application/json" },
      payload: { userName: "dupe@acme.com" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects provisioning a user whose email domain doesn't match the org's configured SSO domain (security review finding)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: { authorization: `Bearer ${scimToken}`, "content-type": "application/json" },
      payload: { userName: "attacker@totally-different-domain.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DEPROVISIONING: deactivating a user via SCIM immediately kills their active session", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: { authorization: `Bearer ${scimToken}`, "content-type": "application/json" },
      payload: { userName: "leaving@acme.com" },
    });
    const userId = createRes.json().id;

    const loginRes = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email: "leaving@acme.com" } });
    const cookie = extractCookie(loginRes.headers["set-cookie"]);

    // Confirm the session works before deactivation.
    const meBefore = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(meBefore.statusCode).toBe(200);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/scim/v2/Users/${userId}`,
      headers: { authorization: `Bearer ${scimToken}`, "content-type": "application/json" },
      payload: { active: false },
    });
    expect(patchRes.statusCode).toBe(200);

    // The PRE-EXISTING session must stop working immediately — this is the
    // whole point of Part 6.1's "an admin firing someone must be able to
    // kill their session now."
    const meAfter = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(meAfter.statusCode).toBe(401);

    // And they can no longer even establish a new session via dev-login.
    const reloginRes = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email: "leaving@acme.com" } });
    const reloginCookie = extractCookie(reloginRes.headers["set-cookie"]);
    const meRelogin = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: reloginCookie } });
    expect(meRelogin.statusCode).toBe(401);
  });

  it("a SCIM token from a DIFFERENT org's SSO setup cannot provision users into this org", async () => {
    const otherOwner = await loginAs(app, `other-${randomUUID()}@othercorp.com`);
    await upgradeToEnterprise(app, otherOwner.orgId);
    const otherSetup = await app.inject({
      method: "PUT",
      url: "/v1/enterprise/sso",
      headers: { cookie: otherOwner.cookie },
      payload: { provider: "okta", domain: "othercorp.com", enabled: true },
    });
    const otherScimToken = otherSetup.json().scimToken;

    const createRes = await app.inject({
      method: "POST",
      url: "/scim/v2/Users",
      headers: { authorization: `Bearer ${otherScimToken}`, "content-type": "application/json" },
      payload: { userName: "cross-org-attempt@othercorp.com" }, // matches the OTHER org's configured SSO domain
    });
    expect(createRes.statusCode).toBe(201);

    // Confirm it landed in the OTHER org, not this test's `orgId`.
    const listRes = await app.inject({ method: "GET", url: "/scim/v2/Users", headers: { authorization: `Bearer ${scimToken}` } });
    const emails = listRes.json().Resources.map((r: { userName: string }) => r.userName);
    expect(emails).not.toContain("cross-org-attempt@othercorp.com");
  });
});
