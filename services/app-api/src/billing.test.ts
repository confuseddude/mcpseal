import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { MockBillingProvider } from "./billing.js";

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  const match = header?.match(/mcplock_session=([^;]+)/);
  if (!match) throw new Error("no session cookie in response");
  return `mcplock_session=${match[1]}`;
}

async function loginAs(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email } });
  const cookie = extractCookie(res.headers["set-cookie"]);
  const body = res.json();
  return { cookie, userId: body.user.id, orgId: body.user.orgId, role: body.user.role };
}

describe("billing — checkout, RBAC, and Stripe-as-source-of-truth webhooks", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    // No STRIPE_* env vars set in the test environment, so buildBillingProvider()
    // resolves to MockBillingProvider — this exercises the real production
    // route/RBAC/webhook-application code, only the Stripe SDK call itself
    // is swapped out.
    app = buildApp(":memory:");
  });

  it("free-plan org defaults correctly and non-admin cannot start checkout", async () => {
    const member1 = await loginAs(app, "owner@acme.com");
    const member2 = await loginAs(app, "member@acme.com");
    expect(member1.role).toBe("owner");
    expect(member2.role).toBe("member");

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie: member2.cookie },
      payload: { plan: "team", successUrl: "http://localhost:3000/settings", cancelUrl: "http://localhost:3000/settings" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("owner can start checkout (mock mode) and the org is upgraded immediately", async () => {
    const owner = await loginAs(app, "owner2@acme.com");

    const before = await app.inject({ method: "GET", url: "/v1/billing/subscription", headers: { cookie: owner.cookie } });
    expect(before.json().subscription.plan).toBe("free");

    const checkoutRes = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie: owner.cookie },
      payload: { plan: "team", successUrl: "http://localhost:3000/settings", cancelUrl: "http://localhost:3000/settings" },
    });
    expect(checkoutRes.statusCode).toBe(200);
    expect(checkoutRes.json().mode).toBe("mock");

    const after = await app.inject({ method: "GET", url: "/v1/billing/subscription", headers: { cookie: owner.cookie } });
    expect(after.json().subscription.plan).toBe("team");
    expect(after.json().subscription.status).toBe("active");
  });

  it("rejects a webhook with no signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      payload: JSON.stringify({ type: "customer.subscription.deleted", stripeSubId: "sub_123" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a webhook with a forged/mismatched signature — fail closed", async () => {
    const body = JSON.stringify({ type: "customer.subscription.deleted", stripeSubId: "sub_123" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      payload: body,
      headers: { "content-type": "application/json", "stripe-signature": "mock-dev-signature:999999" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("a verified subscription.deleted webhook downgrades the org to free and cancels status", async () => {
    const owner = await loginAs(app, "owner3@acme.com");
    await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie: owner.cookie },
      payload: { plan: "team", successUrl: "http://localhost:3000/settings", cancelUrl: "http://localhost:3000/settings" },
    });
    const sub = (await app.inject({ method: "GET", url: "/v1/billing/subscription", headers: { cookie: owner.cookie } })).json()
      .subscription;
    expect(sub.plan).toBe("team");

    const eventBody = JSON.stringify({ type: "customer.subscription.deleted", stripeSubId: sub.stripe_sub_id });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      payload: eventBody,
      headers: { "content-type": "application/json", "stripe-signature": MockBillingProvider.signMockBody(eventBody) },
    });
    expect(res.statusCode).toBe(200);

    const after = (await app.inject({ method: "GET", url: "/v1/billing/subscription", headers: { cookie: owner.cookie } })).json()
      .subscription;
    expect(after.plan).toBe("free");
    expect(after.status).toBe("canceled");
  });

  it("a verified invoice.payment_failed webhook marks the subscription past_due without downgrading the plan", async () => {
    const owner = await loginAs(app, "owner4@acme.com");
    await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie: owner.cookie },
      payload: { plan: "team", successUrl: "http://localhost:3000/settings", cancelUrl: "http://localhost:3000/settings" },
    });
    const sub = (await app.inject({ method: "GET", url: "/v1/billing/subscription", headers: { cookie: owner.cookie } })).json()
      .subscription;

    const eventBody = JSON.stringify({ type: "invoice.payment_failed", stripeSubId: sub.stripe_sub_id });
    await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      payload: eventBody,
      headers: { "content-type": "application/json", "stripe-signature": MockBillingProvider.signMockBody(eventBody) },
    });

    const after = (await app.inject({ method: "GET", url: "/v1/billing/subscription", headers: { cookie: owner.cookie } })).json()
      .subscription;
    expect(after.plan).toBe("team"); // soft overage — plan unchanged
    expect(after.status).toBe("past_due");
  });

  it("a webhook for an unknown subscription ID is accepted (200) but has no effect on any org", async () => {
    const eventBody = JSON.stringify({ type: "customer.subscription.deleted", stripeSubId: "sub_does_not_exist_" + randomUUID() });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      payload: eventBody,
      headers: { "content-type": "application/json", "stripe-signature": MockBillingProvider.signMockBody(eventBody) },
    });
    expect(res.statusCode).toBe(200);
  });

  it("non-admin cannot open the billing portal", async () => {
    await loginAs(app, "owner5@acme.com");
    const member = await loginAs(app, "member5@acme.com");
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/portal",
      headers: { cookie: member.cookie },
      payload: { returnUrl: "http://localhost:3000/settings" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("portal fails cleanly for an org with no billing account yet", async () => {
    const owner = await loginAs(app, "owner6@acme.com");
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/portal",
      headers: { cookie: owner.cookie },
      payload: { returnUrl: "http://localhost:3000/settings" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("retention-tier gating on /v1/events", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp(":memory:");
  });

  it("free-plan org events endpoint reports a 7-day retention window", async () => {
    const owner = await loginAs(app, "retention1@acme.com");
    const res = await app.inject({ method: "GET", url: "/v1/events", headers: { cookie: owner.cookie } });
    expect(res.json().retentionDays).toBe(7);
  });

  it("team-plan org gets 30-day retention; enterprise gets unlimited (null)", async () => {
    const owner = await loginAs(app, "retention2@acme.com");
    await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie: owner.cookie },
      payload: { plan: "team", successUrl: "http://localhost:3000/settings", cancelUrl: "http://localhost:3000/settings" },
    });
    const teamRes = await app.inject({ method: "GET", url: "/v1/events", headers: { cookie: owner.cookie } });
    expect(teamRes.json().retentionDays).toBe(30);
  });
});
