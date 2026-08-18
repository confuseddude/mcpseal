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
  listMachinesForWorkspaces,
  listEventsForWorkspaces,
  listApiKeysForWorkspaces,
  revokeApiKey,
  findApiKeyWorkspace,
  insertPolicy,
  listPoliciesForOrg,
  getSubscription,
  type Role,
  type User,
} from "./db.js";
import { hasAtLeastRole } from "./rbac.js";

const SESSION_COOKIE = "mcplock_session";

const emailSchema = z.object({ email: z.string().email() });

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
  const dashboardOrigins = (process.env.MCPLOCK_DASHBOARD_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.register(cors, { origin: dashboardOrigins, credentials: true });

  async function currentUser(req: FastifyRequest): Promise<{ user: User; sessionId: string } | null> {
    const sessionId = req.cookies[SESSION_COOKIE];
    if (!sessionId) return null;
    const session = findValidSession(db, sessionId);
    if (!session) return null;
    const user = findUserById(db, session.userId);
    if (!user) return null;
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
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });

    const domain = orgIdOf(parsed.data.email);
    const org = findOrCreateOrgByDomain(db, domain);
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

    const parsed = roleSchema.safeParse(req.body);
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

  // --- Live Feed ---
  app.get("/v1/events", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    const limitParam = (req.query as { limit?: string }).limit;
    const limit = Math.min(Math.max(Number(limitParam) || 100, 1), 500);
    const workspaceIds = listWorkspacesForOrg(db, ctx.user.orgId).map((w) => w.id);
    return reply.send({ events: listEventsForWorkspaces(db, workspaceIds, limit) });
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

  // --- Policy (draft CRUD only — signing/distribution is Milestone 6) ---
  const policySchema = z.object({ lockfileJson: z.string().min(2) });
  app.post("/v1/policies", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    if (!requireRole(ctx.user, "admin")) return reply.status(403).send({ error: "requires admin or owner" });

    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });
    try {
      JSON.parse(parsed.data.lockfileJson);
    } catch {
      return reply.status(400).send({ error: "lockfileJson must be valid JSON" });
    }
    const policy = insertPolicy(db, ctx.user.orgId, parsed.data.lockfileJson, null, ctx.user.id);
    return reply.status(201).send({ policy });
  });

  app.get("/v1/policies", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    return reply.send({ policies: listPoliciesForOrg(db, ctx.user.orgId) });
  });

  // --- Billing (subscription read; Checkout/webhooks land in Milestone 5) ---
  app.get("/v1/billing/subscription", async (req, reply) => {
    const ctx = await currentUser(req);
    if (!ctx) return reply.status(401).send({ error: "not authenticated" });
    return reply.send({ subscription: getSubscription(db, ctx.user.orgId) });
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.decorate("mcplockDb", db);
  return app;
}
