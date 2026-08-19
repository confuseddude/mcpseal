// build-bible.md Part 4.1/6/7: the App API — "the read/write backend for
// everything a human touches." Session auth + server-side RBAC on every
// protected route (CLAUDE.md invariant 7); the dashboard never talks to
// Postgres or the Event Store directly (build-bible "What NOT to do"),
// only through here.
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { z } from "zod";
import type Database from "better-sqlite3";
import {
  openDb,
  findOrCreateOrgByDomain,
  findOrCreateUser,
  countUsersInOrg,
  findUserById,
  listUsersInOrg,
  updateUserRole,
  createSession,
  findValidSession,
  revokeSession,
  listWorkspacesForOrg,
  approveDeviceCodeForWorkspace,
  listMachinesForWorkspaces,
  listEventsForWorkspaces,
  listApiKeysForWorkspaces,
  revokeApiKey,
  findApiKeyWorkspace,
  insertPolicy,
  listPoliciesForOrg,
  listAuditEventsForWorkspaces,
  getSubscription,
  upsertSubscription,
  findSubscriptionByStripeSubId,
  type Role,
  type Plan,
  type User,
} from "./db.js";
import { hasAtLeastRole } from "./rbac.js";
import { buildBillingProvider, MockBillingProvider, type WebhookEvent } from "./billing.js";
import { generateOrgSigningKeypair, signWithOrgKey, generateScimToken, hashScimToken } from "./org-crypto.js";
import {
  getOrgSigningKey,
  insertOrgSigningKey,
  getSsoConfig,
  upsertSsoConfig,
  findOrgByScimTokenHash,
  findUserByEmail,
  createUserViaScim,
  setUserActive,
  revokeAllSessionsForUser,
} from "./db.js";
import { verifyAuditChain, eventsToCsv } from "./audit.js";

// build-bible.md Part 5.2: "Retention is a billing lever, not just an ops
// setting: 30-day TTL on Team, configurable/unlimited on Enterprise."
// Free-tier retention (7 days) isn't spec'd explicitly; chosen short enough
// to create real upgrade pressure without making the free Live Feed
// pointless. Team's 30 days matches the spec text exactly.
const RETENTION_DAYS_BY_PLAN: Record<Plan, number | null> = { free: 7, team: 30, enterprise: null };

const SESSION_COOKIE = "mcpseal_session";

const emailSchema = z.object({ email: z.string().email() });

// build-bible.md Part 8.1: policies are signed with "the org's private
// signing key." Every org gets exactly one signing keypair, generated the
// first time it's needed and reused thereafter — never rotated silently,
// since a client pins this public key at login (Part 8.1) and a silent
// rotation would make every previously-pinned client reject all future
// policies.
function ensureOrgSigningKey(db: Database.Database, orgId: string): string {
  const existing = getOrgSigningKey(db, orgId);
  if (existing) return existing.publicKey;
  const { publicKeyHex, encryptedPrivateKey } = generateOrgSigningKeypair();
  insertOrgSigningKey(db, orgId, publicKeyHex, encryptedPrivateKey);
  return publicKeyHex;
}

function orgIdOf(email: string): string {
  const at = email.lastIndexOf("@");
  return email.slice(at + 1).toLowerCase();
}

export function buildApp(dbPath: string): FastifyInstance {
  const db: Database.Database = openDb(dbPath);
  const app = Fastify({ logger: false });
  app.register(cookie);
  // The dashboard runs on its own origin (Next.js dev server / hosted
  // domain) and needs the session cookie sent cross-origin, so the origin
  // allowlist must be explicit and credentials must be enabled — a
  // wildcard origin with credentials is rejected by browsers anyway, but
  // being explicit here also keeps other origins from reading responses.
  const dashboardOrigins = (process.env.MCPSEAL_DASHBOARD_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.register(cors, { origin: dashboardOrigins, credentials: true });

  // Same rationale as services/ingest/src/app.ts: capture the exact raw
  // body bytes so the Stripe webhook signature (and, incidentally, every
  // other JSON route) can be verified/parsed against precisely what was
  // sent, not a re-serialized reconstruction.
  const jsonParser = (_req: unknown, body: unknown, done: (err: Error | null, result?: unknown) => void) => {
    try {
      const json = JSON.parse(body as string);
      done(null, { raw: body as string, json });
    } catch {
      const err = new Error("malformed JSON body") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  };
  app.addContentTypeParser("application/json", { parseAs: "string" }, jsonParser);
  app.addContentTypeParser("*", { parseAs: "string" }, jsonParser);

  async function currentUser(req: FastifyRequest): Promise<{ user: User; sessionId: string } | null> {
    const sessionId = req.cookies[SESSION_COOKIE];
    if (!sessionId) return null;
    const session = findValidSession(db, sessionId);
    if (!session) return null;
    const user = findUserById(db, session.userId);
    if (!user) return null;
    // build-bible Part 6.1: "an admin firing someone must be able to kill
    // their session now." SCIM deactivation flips this flag AND revokes
    // sessions (belt and suspenders) — checked here too so a session
    // created before deactivation can't keep working via some other path.
    if (!user.active) return null;
    return { user, sessionId };
  }

  function requireRole(user: User, minimum: Role): boolean {
    return hasAtLeastRole(user.role, minimum);
  }

  // --- Auth ---
  // MOCK: stands in for WorkOS's hosted-auth callback (Part 6.1). A real
  // integration replaces only this handler's body — exchange a WorkOS
  // authorization code for {email, org} instead of trusting the client's
  // claimed email outright — everything downstream (upsert, session,
  // cookie) is already the real production shape.
  app.post("/v1/auth/dev-login", async (req, reply) => {
    const parsed = emailSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });

    const domain = orgIdOf(parsed.data.email);
    const org = findOrCreateOrgByDomain(db, domain);
    ensureOrgSigningKey(db, org.id);
    const isFirst = countUsersInOrg(db, org.id) === 0;
    const user = findOrCreateUser(db, parsed.data.email, org.id, isFirst);
    const session = createSession(db, user.id, org.id);

    reply.setCookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(session.expiresAt),
    });
    return reply.send({ user, org });
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const ctx = await currentUser(req);
    if (ctx) revokeSession(db, ctx.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/v1/auth/me", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    return reply.send({ user: ctx.user });
  });

  // --- Members (RBAC + cross-org isolation exercised here) ---
  app.get("/v1/members", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    // Always scoped to the session's own org — never to a client-supplied
    // orgId — this is what makes cross-org access structurally impossible
    // rather than merely policy-forbidden.
    return reply.send({ members: listUsersInOrg(db, ctx.user.orgId) });
  });

  const roleSchema = z.object({ role: z.enum(["owner", "admin", "member", "viewer"]) });
  app.patch("/v1/members/:userId/role", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });

    const parsed = roleSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });

    const target = findUserById(db, (req.params as { userId: string }).userId);
    if (!target || target.orgId !== ctx.user.orgId) {
      // Same 404 whether the user doesn't exist or belongs to another org —
      // never leak cross-org existence via a 403-vs-404 distinction.
      return reply.status(404).send({ error: "user not found" });
    }
    updateUserRole(db, target.id, parsed.data.role);
    return reply.send({ ok: true });
  });

  // --- Workspaces / Fleet ---
  app.get("/v1/workspaces", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    return reply.send({ workspaces: listWorkspacesForOrg(db, ctx.user.orgId) });
  });

  app.get("/v1/machines", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    const workspaceIds = listWorkspacesForOrg(db, ctx.user.orgId).map((w) => w.id);
    return reply.send({ machines: listMachinesForWorkspaces(db, workspaceIds) });
  });

  // --- Connect a machine (Part 6.2's device-flow "approve" step, called
  // for real by an authenticated Dashboard session rather than the
  // dev-auto-approve env var — closes the gap flagged in
  // NIGHT_SHIFT_LOG.md's Morning Action Items #4) ---
  const connectMachineSchema = z.object({ userCode: z.string().min(1).max(32), workspaceId: z.string().uuid().optional() });
  app.post("/v1/machines/connect", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });

    const parsed = connectMachineSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });

    const orgWorkspaces = listWorkspacesForOrg(db, ctx.user.orgId);
    if (orgWorkspaces.length === 0) return reply.status(404).send({ error: "org has no workspace" });

    let workspaceId = parsed.data.workspaceId;
    if (workspaceId) {
      // Never trust a client-supplied workspaceId outright — it must
      // belong to the approving session's own org, or this is a
      // cross-org machine-provisioning vector.
      if (!orgWorkspaces.some((w) => w.id === workspaceId)) {
        return reply.status(404).send({ error: "workspace not found" });
      }
    } else {
      workspaceId = orgWorkspaces[0].id;
    }

    const ok = approveDeviceCodeForWorkspace(db, parsed.data.userCode.trim().toUpperCase(), workspaceId);
    if (!ok) return reply.status(404).send({ error: "unknown or expired code" });
    return reply.send({ approved: true, workspaceId });
  });

  // --- Live Feed ---
  app.get("/v1/events", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    const limitParam = (req.query as { limit?: string }).limit;
    const limit = Math.min(Math.max(Number(limitParam) || 100, 1), 500);
    const workspaceIds = listWorkspacesForOrg(db, ctx.user.orgId).map((w) => w.id);
    const events = listEventsForWorkspaces(db, workspaceIds, limit);

    // Retention-tier gating happens server-side, on every request — never
    // trust a client to only ask for what its plan allows.
    const plan = getSubscription(db, ctx.user.orgId).plan;
    const retentionDays = RETENTION_DAYS_BY_PLAN[plan];
    const filtered =
      retentionDays === null
        ? events
        : events.filter((e) => Date.now() - new Date(e.ts).getTime() <= retentionDays * 24 * 60 * 60 * 1000);

    return reply.send({ events: filtered, retentionDays });
  });

  // --- API keys (Settings) ---
  app.get("/v1/api-keys", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });
    const workspaceIds = listWorkspacesForOrg(db, ctx.user.orgId).map((w) => w.id);
    return reply.send({ apiKeys: listApiKeysForWorkspaces(db, workspaceIds) });
  });

  app.delete("/v1/api-keys/:keyId", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });

    const keyId = (req.params as { keyId: string }).keyId;
    const workspaceId = findApiKeyWorkspace(db, keyId);
    const orgWorkspaceIds = new Set(listWorkspacesForOrg(db, ctx.user.orgId).map((w) => w.id));
    if (!workspaceId || !orgWorkspaceIds.has(workspaceId)) {
      return reply.status(404).send({ error: "api key not found" });
    }
    revokeApiKey(db, keyId);
    return reply.send({ ok: true });
  });

  // --- Policy (build-bible Part 8.1: signed distribution) ---
  const policySchema = z.object({ lockfileJson: z.string().min(2) });
  app.post("/v1/policies", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });

    const parsed = policySchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });
    try {
      JSON.parse(parsed.data.lockfileJson);
    } catch {
      return reply.status(400).send({ error: "lockfileJson must be valid JSON" });
    }

    // Sign over exactly the bytes returned to and stored by clients — never
    // a re-serialized reconstruction, so verification can't diverge from
    // what was actually signed (build-bible Part 8.1/9).
    const orgKey = getOrgSigningKey(db, ctx.user.orgId);
    if (!orgKey) return reply.status(500).send({ error: "org has no signing key — this should never happen after login" });
    const signature = signWithOrgKey(orgKey.encryptedPrivateKey, parsed.data.lockfileJson);

    const policy = insertPolicy(db, ctx.user.orgId, parsed.data.lockfileJson, signature, ctx.user.id);
    return reply.status(201).send({ policy });
  });

  app.get("/v1/policies", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    return reply.send({ policies: listPoliciesForOrg(db, ctx.user.orgId) });
  });

  // Public key is not secret — this is what a client pins at login (Part
  // 8.1) and verifies every future policy pull against.
  app.get("/v1/policy/signing-key", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    const orgKey = getOrgSigningKey(db, ctx.user.orgId);
    if (!orgKey) return reply.status(404).send({ error: "no signing key for this org" });
    return reply.send({ publicKey: orgKey.publicKey });
  });

  // --- SSO config + SCIM provisioning (build-bible Part 6.1/8.2) ---
  // MOCK / NOT a real SAML or OIDC implementation. CLAUDE.md and
  // build-bible Part 6.1 are explicit: "Do not hand-roll SAML/OIDC" — this
  // is only the config surface (which provider, which domain, on/off) and
  // the SCIM user-provisioning contract, which is genuinely simple enough
  // to implement for real. The actual login handshake (validating a SAML
  // assertion or OIDC token from Okta/Entra/Ping) is NOT implemented and
  // must come from a real WorkOS integration — see NIGHT_SHIFT_LOG.md.
  const ssoConfigSchema = z.object({ provider: z.enum(["okta", "entra", "ping", "generic-saml", "generic-oidc"]), domain: z.string().min(1), enabled: z.boolean() });
  app.put("/v1/enterprise/sso", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });
    if (getSubscription(db, ctx.user.orgId).plan !== "enterprise") {
      return reply.status(403).send({ error: "SSO/SCIM requires the Enterprise plan" });
    }
    const parsed = ssoConfigSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });

    // A SCIM token is generated once, on first enable, and never shown
    // again — same "shown exactly once" discipline as the workspace API
    // keys (Part 5.1).
    const existing = getSsoConfig(db, ctx.user.orgId);
    let scimToken: string | null = null;
    let scimTokenHash: string | null = existing?.scimTokenHash ?? null;
    if (!existing?.scimTokenHash) {
      const generated = generateScimToken();
      scimToken = generated.token;
      scimTokenHash = generated.hash;
    }
    upsertSsoConfig(db, ctx.user.orgId, parsed.data.provider, parsed.data.domain, parsed.data.enabled, scimTokenHash);
    return reply.send({ provider: parsed.data.provider, domain: parsed.data.domain, enabled: parsed.data.enabled, scimToken });
  });

  app.get("/v1/enterprise/sso", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });
    const config = getSsoConfig(db, ctx.user.orgId);
    if (!config) return reply.send({ config: null });
    // Never return the token hash — it's a secret-lookup value, not
    // display data (CLAUDE.md invariant 6).
    return reply.send({ config: { provider: config.provider, domain: config.domain, enabled: config.enabled } });
  });

  async function authenticateScim(req: FastifyRequest): Promise<string | null> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return null;
    const token = auth.slice("Bearer ".length).trim();
    const orgId = findOrgByScimTokenHash(db, hashScimToken(token));
    return orgId ?? null;
  }

  app.get("/scim/v2/Users", async (req, reply) => {
    const orgId = await authenticateScim(req);
    if (!orgId) return reply.status(401).send({ error: "invalid SCIM token" });
    const users = listUsersInOrg(db, orgId);
    return reply.send({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: users.length,
      Resources: users.map((u) => ({ id: u.id, userName: u.email, active: u.active, emails: [{ value: u.email }] })),
    });
  });

  const scimCreateSchema = z.object({ userName: z.string().email(), active: z.boolean().optional() });
  app.post("/scim/v2/Users", async (req, reply) => {
    const orgId = await authenticateScim(req);
    if (!orgId) return reply.status(401).send({ error: "invalid SCIM token" });
    const parsed = scimCreateSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed SCIM payload" });

    // Security review finding: without this check, any holder of this
    // org's SCIM token could provision an account under an arbitrary email
    // domain, not just the domain the org actually configured SSO for.
    const ssoConfig = getSsoConfig(db, orgId);
    const emailDomain = parsed.data.userName.split("@")[1]?.toLowerCase();
    if (!ssoConfig || emailDomain !== ssoConfig.domain.toLowerCase()) {
      return reply.status(400).send({ error: `userName domain must match the configured SSO domain (${ssoConfig?.domain ?? "none configured"})` });
    }

    const existing = findUserByEmail(db, parsed.data.userName);
    if (existing) return reply.status(409).send({ error: "user already exists" });
    const user = createUserViaScim(db, orgId, parsed.data.userName, null, "member");
    return reply.status(201).send({ id: user.id, userName: user.email, active: user.active });
  });

  const scimPatchSchema = z.object({ active: z.boolean() });
  app.patch("/scim/v2/Users/:userId", async (req, reply) => {
    const orgId = await authenticateScim(req);
    if (!orgId) return reply.status(401).send({ error: "invalid SCIM token" });
    const parsed = scimPatchSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed SCIM payload" });

    const userId = (req.params as { userId: string }).userId;
    const user = findUserById(db, userId);
    if (!user || user.orgId !== orgId) return reply.status(404).send({ error: "user not found" });

    setUserActive(db, userId, parsed.data.active);
    if (!parsed.data.active) {
      // Deprovisioning must take effect immediately, not at next session
      // expiry (Part 6.1).
      revokeAllSessionsForUser(db, userId);
    }
    return reply.send({ id: userId, active: parsed.data.active });
  });

  // --- Audit export (build-bible Part 8.3, Enterprise-gated) ---
  app.get("/v1/audit/export", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });

    const plan = getSubscription(db, ctx.user.orgId).plan;
    if (plan !== "enterprise") {
      return reply.status(403).send({ error: "tamper-evident audit export requires the Enterprise plan" });
    }

    const format = (req.query as { format?: string }).format === "csv" ? "csv" : "json";
    const workspaces = listWorkspacesForOrg(db, ctx.user.orgId);
    const allEvents = listAuditEventsForWorkspaces(db, workspaces.map((w) => w.id));

    // Verify per-workspace (a chain only has meaning within one workspace's
    // sequence — see audit.ts) and include the verification result IN the
    // export, so a tampered export is self-describing even before an
    // auditor reruns the standalone script.
    const byWorkspace = new Map<string, typeof allEvents>();
    for (const e of allEvents) {
      const list = byWorkspace.get(e.workspaceId) ?? [];
      list.push(e);
      byWorkspace.set(e.workspaceId, list);
    }
    const verification = Object.fromEntries(
      [...byWorkspace.entries()].map(([workspaceId, events]) => [workspaceId, verifyAuditChain(workspaceId, events)])
    );

    if (format === "csv") {
      reply.header("content-type", "text/csv");
      return reply.send(eventsToCsv(allEvents));
    }
    return reply.send({ events: allEvents, verification });
  });

  // --- Billing (build-bible Part 10) ---
  const billing = buildBillingProvider();

  app.get("/v1/billing/subscription", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    return reply.send({ subscription: getSubscription(db, ctx.user.orgId) });
  });

  const checkoutSchema = z.object({ plan: z.literal("team"), successUrl: z.string().url(), cancelUrl: z.string().url() });
  app.post("/v1/billing/checkout", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });

    const parsed = checkoutSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });

    const result = await billing.createCheckoutSession(ctx.user.orgId, parsed.data.plan, parsed.data.successUrl, parsed.data.cancelUrl);
    if (result.mockImmediateOutcome) {
      // Mock mode only: there is no real Stripe webhook coming, so apply
      // the outcome the same way the webhook handler below would.
      upsertSubscription(db, ctx.user.orgId, {
        stripeCustomerId: result.mockImmediateOutcome.stripeCustomerId,
        stripeSubId: result.mockImmediateOutcome.stripeSubId,
        plan: result.mockImmediateOutcome.plan,
        seats: 1,
        status: "active",
      });
    }
    return reply.send({ url: result.url, mode: billing.mode });
  });

  const portalSchema = z.object({ returnUrl: z.string().url() });
  app.post("/v1/billing/portal", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });

    const parsed = portalSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });

    const sub = getSubscription(db, ctx.user.orgId);
    if (!sub.stripe_customer_id) return reply.status(400).send({ error: "no billing account yet — checkout first" });
    const result = await billing.createPortalSession(sub.stripe_customer_id, parsed.data.returnUrl);
    return reply.send({ url: result.url });
  });

  // Stripe is the source of truth (Part 10); this is the ONLY code path
  // allowed to change an org's plan after initial checkout. Signature
  // verification is mandatory and fails closed — an unverified body is
  // never applied, matching Part 9's "any error verifying... rejects."
  app.post("/v1/billing/webhook", async (req, reply) => {
    const rawBody = (req.body as any)?.raw as string | undefined;
    if (typeof rawBody !== "string") return reply.status(400).send({ error: "malformed request body" });

    const signatureHeader = req.headers["stripe-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    let event: WebhookEvent;
    try {
      event = billing.verifyWebhook(rawBody, signature);
    } catch (err) {
      return reply.status(400).send({ error: `webhook verification failed: ${(err as Error).message}` });
    }

    applyWebhookEvent(db, event);
    return reply.send({ received: true });
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.decorate("mcpsealDb", db);
  return app;
}

// Stripe is authoritative (Part 10): every branch here mirrors a Stripe
// state transition into `subscriptions`/`orgs.plan`, never the reverse.
// Unmapped subscriptions (no matching org — e.g. a stale/foreign event) are
// silently ignored rather than throwing, since a 500 here would make
// Stripe retry a webhook this service can never successfully act on.
function applyWebhookEvent(db: Database.Database, event: WebhookEvent): void {
  switch (event.type) {
    case "checkout.session.completed": {
      upsertSubscription(db, event.orgId, {
        stripeCustomerId: event.stripeCustomerId,
        stripeSubId: event.stripeSubId,
        plan: event.plan,
        seats: 1,
        status: "active",
      });
      return;
    }
    case "customer.subscription.updated": {
      const existing = findSubscriptionByStripeSubId(db, event.stripeSubId);
      if (!existing) return;
      upsertSubscription(db, existing.org_id, {
        stripeCustomerId: existing.stripe_customer_id,
        stripeSubId: existing.stripe_sub_id,
        plan: event.plan,
        seats: existing.seats,
        status: event.status,
      });
      return;
    }
    case "customer.subscription.deleted": {
      const existing = findSubscriptionByStripeSubId(db, event.stripeSubId);
      if (!existing) return;
      upsertSubscription(db, existing.org_id, {
        stripeCustomerId: existing.stripe_customer_id,
        stripeSubId: existing.stripe_sub_id,
        plan: "free",
        seats: existing.seats,
        status: "canceled",
      });
      return;
    }
    case "invoice.payment_failed": {
      const existing = findSubscriptionByStripeSubId(db, event.stripeSubId);
      if (!existing) return;
      // Soft overage per Part 10 ("prefer a soft overage over a hard
      // wall"): a failed payment marks the account past_due without
      // immediately downgrading the plan or cutting off access.
      upsertSubscription(db, existing.org_id, {
        stripeCustomerId: existing.stripe_customer_id,
        stripeSubId: existing.stripe_sub_id,
        plan: existing.plan,
        seats: existing.seats,
        status: "past_due",
      });
      return;
    }
  }
}
