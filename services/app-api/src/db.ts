// build-bible.md Part 5.1: the Postgres domain model for orgs/users/teams/
// workspaces/sessions/policies/subscriptions. Same local-dev-SQLite
// approach as services/ingest/src/db.ts (see NIGHT_SHIFT_LOG.md Milestone
// 3 for the rationale) — in dev this file points at the SAME physical
// SQLite file ingest uses (mirrors "both services connect to the same
// Postgres instance in production"), so a workspace/machine created via
// login is visible to both services without RPC between them.
//
// PRODUCTION WIRING REQUIRED: replace with a real Postgres client, keeping
// these function signatures.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type Role = "owner" | "admin" | "member" | "viewer";
export type Plan = "free" | "team" | "enterprise";

export interface Org {
  id: string;
  name: string;
  domain: string;
  plan: Plan;
  createdAt: string;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  orgId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface Policy {
  id: string;
  orgId: string;
  version: number;
  lockfileJson: string;
  signature: string | null;
  createdBy: string;
  createdAt: string;
}

export function openDb(filePath: string): Database.Database {
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      lockfile_json TEXT NOT NULL,
      signature TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL UNIQUE,
      stripe_customer_id TEXT,
      stripe_sub_id TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      seats INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active'
    );

    -- Owned by services/ingest in normal operation; declared here too
    -- (IF NOT EXISTS, identical shape) so app-api can read/join them
    -- regardless of which service starts first against the shared file.
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      machine_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      hostname_hash TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      mcplock_version TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      key_id TEXT NOT NULL UNIQUE,
      key_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used TEXT,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      server TEXT NOT NULL,
      tool TEXT NOT NULL,
      observed_hash TEXT,
      expected_hash TEXT,
      description_diff TEXT,
      client_app TEXT NOT NULL,
      severity TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );
  `);
  return db;
}

// Upsert-by-domain: first user from a given email domain creates the org
// (and becomes owner); subsequent users from the same domain join as
// members. This is the dev-mock's stand-in for a real signup/invite flow.
export function findOrCreateOrgByDomain(db: Database.Database, domain: string): Org {
  const existing = db.prepare("SELECT * FROM orgs WHERE domain = ?").get(domain) as
    | { id: string; name: string; domain: string; plan: Plan; created_at: string }
    | undefined;
  if (existing) {
    return { id: existing.id, name: existing.name, domain: existing.domain, plan: existing.plan, createdAt: existing.created_at };
  }
  const org: Org = { id: randomUUID(), name: domain, domain, plan: "free", createdAt: new Date().toISOString() };
  db.prepare("INSERT INTO orgs (id, name, domain, plan, created_at) VALUES (?, ?, ?, ?, ?)").run(org.id, org.name, org.domain, org.plan, org.createdAt);
  // A brand-new org gets a default workspace immediately — machines/events
  // are meaningless without one, and the free tier doesn't require this
  // step, so a Team/Enterprise org should get it automatically at creation.
  const wsId = randomUUID();
  db.prepare("INSERT INTO workspaces (id, org_id, name, created_at) VALUES (?, ?, ?, ?)").run(wsId, org.id, "default", org.createdAt);
  return org;
}

export function findOrCreateUser(db: Database.Database, email: string, orgId: string, isFirstInOrg: boolean): User {
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | { id: string; org_id: string; email: string; name: string | null; role: Role; created_at: string }
    | undefined;
  if (existing) {
    return { id: existing.id, orgId: existing.org_id, email: existing.email, name: existing.name, role: existing.role, createdAt: existing.created_at };
  }
  const user: User = {
    id: randomUUID(),
    orgId,
    email,
    name: null,
    role: isFirstInOrg ? "owner" : "member",
    createdAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO users (id, org_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    user.id,
    user.orgId,
    user.email,
    user.name,
    user.role,
    user.createdAt
  );
  return user;
}

export function countUsersInOrg(db: Database.Database, orgId: string): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM users WHERE org_id = ?").get(orgId) as { c: number };
  return row.c;
}

export function findUserById(db: Database.Database, userId: string): User | undefined {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    | { id: string; org_id: string; email: string; name: string | null; role: Role; created_at: string }
    | undefined;
  if (!row) return undefined;
  return { id: row.id, orgId: row.org_id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at };
}

export function listUsersInOrg(db: Database.Database, orgId: string): User[] {
  const rows = db.prepare("SELECT * FROM users WHERE org_id = ? ORDER BY created_at ASC").all(orgId) as Array<{
    id: string;
    org_id: string;
    email: string;
    name: string | null;
    role: Role;
    created_at: string;
  }>;
  return rows.map((r) => ({ id: r.id, orgId: r.org_id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at }));
}

export function updateUserRole(db: Database.Database, userId: string, role: Role): void {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function createSession(db: Database.Database, userId: string, orgId: string): Session {
  const session: Session = {
    id: randomUUID(),
    userId,
    orgId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    revokedAt: null,
  };
  db.prepare("INSERT INTO sessions (id, user_id, org_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    session.id,
    session.userId,
    session.orgId,
    session.createdAt,
    session.expiresAt,
    session.revokedAt
  );
  return session;
}

export function findValidSession(db: Database.Database, sessionId: string): Session | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
    | { id: string; user_id: string; org_id: string; created_at: string; expires_at: string; revoked_at: string | null }
    | undefined;
  if (!row) return undefined;
  if (row.revoked_at) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) return undefined;
  return { id: row.id, userId: row.user_id, orgId: row.org_id, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at };
}

export function revokeSession(db: Database.Database, sessionId: string): void {
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), sessionId);
}

export function revokeAllSessionsForUser(db: Database.Database, userId: string): void {
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), userId);
}

export function listWorkspacesForOrg(db: Database.Database, orgId: string): Array<{ id: string; orgId: string; name: string; createdAt: string }> {
  const rows = db.prepare("SELECT * FROM workspaces WHERE org_id = ?").all(orgId) as Array<{ id: string; org_id: string; name: string; created_at: string }>;
  return rows.map((r) => ({ id: r.id, orgId: r.org_id, name: r.name, createdAt: r.created_at }));
}

export function listMachinesForWorkspaces(db: Database.Database, workspaceIds: string[]) {
  if (workspaceIds.length === 0) return [];
  const placeholders = workspaceIds.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM machines WHERE workspace_id IN (${placeholders}) ORDER BY last_seen DESC`).all(...workspaceIds) as Array<{
    id: string;
    workspace_id: string;
    machine_id: string;
    public_key: string;
    hostname_hash: string | null;
    first_seen: string;
    last_seen: string;
    mcplock_version: string | null;
  }>;
}

export function listEventsForWorkspaces(db: Database.Database, workspaceIds: string[], limit: number) {
  if (workspaceIds.length === 0) return [];
  const placeholders = workspaceIds.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM events WHERE workspace_id IN (${placeholders}) ORDER BY ts DESC LIMIT ?`)
    .all(...workspaceIds, limit) as Array<{
    event_id: string;
    workspace_id: string;
    machine_id: string;
    ts: string;
    type: string;
    server: string;
    tool: string;
    observed_hash: string | null;
    expected_hash: string | null;
    description_diff: string | null;
    client_app: string;
    severity: string;
    ingested_at: string;
  }>;
}

export function listApiKeysForWorkspaces(db: Database.Database, workspaceIds: string[]) {
  if (workspaceIds.length === 0) return [];
  const placeholders = workspaceIds.map(() => "?").join(",");
  return db.prepare(`SELECT id, workspace_id, key_id, name, created_at, last_used, revoked_at FROM api_keys WHERE workspace_id IN (${placeholders})`).all(...workspaceIds) as Array<{
    id: string;
    workspace_id: string;
    key_id: string;
    name: string;
    created_at: string;
    last_used: string | null;
    revoked_at: string | null;
  }>;
}

export function revokeApiKey(db: Database.Database, keyId: string): void {
  db.prepare("UPDATE api_keys SET revoked_at = ? WHERE key_id = ?").run(new Date().toISOString(), keyId);
}

export function findApiKeyWorkspace(db: Database.Database, keyId: string): string | undefined {
  const row = db.prepare("SELECT workspace_id FROM api_keys WHERE key_id = ?").get(keyId) as { workspace_id: string } | undefined;
  return row?.workspace_id;
}

export function insertPolicy(db: Database.Database, orgId: string, lockfileJson: string, signature: string | null, createdBy: string): Policy {
  const latest = db.prepare("SELECT MAX(version) as v FROM policies WHERE org_id = ?").get(orgId) as { v: number | null };
  const version = (latest.v ?? 0) + 1;
  const policy: Policy = { id: randomUUID(), orgId, version, lockfileJson, signature, createdBy, createdAt: new Date().toISOString() };
  db.prepare("INSERT INTO policies (id, org_id, version, lockfile_json, signature, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    policy.id,
    policy.orgId,
    policy.version,
    policy.lockfileJson,
    policy.signature,
    policy.createdBy,
    policy.createdAt
  );
  return policy;
}

export function listPoliciesForOrg(db: Database.Database, orgId: string): Policy[] {
  const rows = db.prepare("SELECT * FROM policies WHERE org_id = ? ORDER BY version DESC").all(orgId) as Array<{
    id: string;
    org_id: string;
    version: number;
    lockfile_json: string;
    signature: string | null;
    created_by: string;
    created_at: string;
  }>;
  return rows.map((r) => ({ id: r.id, orgId: r.org_id, version: r.version, lockfileJson: r.lockfile_json, signature: r.signature, createdBy: r.created_by, createdAt: r.created_at }));
}

export function getSubscription(db: Database.Database, orgId: string) {
  const row = db.prepare("SELECT * FROM subscriptions WHERE org_id = ?").get(orgId) as
    | { id: string; org_id: string; stripe_customer_id: string | null; stripe_sub_id: string | null; plan: Plan; seats: number; status: string }
    | undefined;
  if (row) return row;
  // Default (no row yet) is the free plan — matches orgs.plan default.
  return { id: "", org_id: orgId, stripe_customer_id: null, stripe_sub_id: null, plan: "free" as Plan, seats: 1, status: "active" };
}

export function upsertSubscription(
  db: Database.Database,
  orgId: string,
  fields: { stripeCustomerId?: string | null; stripeSubId?: string | null; plan: Plan; seats: number; status: string }
): void {
  const existing = db.prepare("SELECT id FROM subscriptions WHERE org_id = ?").get(orgId) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE subscriptions SET stripe_customer_id = ?, stripe_sub_id = ?, plan = ?, seats = ?, status = ? WHERE org_id = ?").run(
      fields.stripeCustomerId ?? null,
      fields.stripeSubId ?? null,
      fields.plan,
      fields.seats,
      fields.status,
      orgId
    );
  } else {
    db.prepare("INSERT INTO subscriptions (id, org_id, stripe_customer_id, stripe_sub_id, plan, seats, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      randomUUID(),
      orgId,
      fields.stripeCustomerId ?? null,
      fields.stripeSubId ?? null,
      fields.plan,
      fields.seats,
      fields.status
    );
  }
  db.prepare("UPDATE orgs SET plan = ? WHERE id = ?").run(fields.plan, orgId);
}
