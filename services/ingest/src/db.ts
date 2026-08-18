// Local dev stand-in for two production systems described in build-bible.md
// Part 4.1/5: Postgres (orgs/workspaces/machines/api_keys — normally the App
// API's domain, but Milestone 3 needs a minimal slice of it to register
// machines before Milestone 4's App API exists) and the Event Store
// (ClickHouse/Timescale, Part 5.2). Both are represented here as SQLite
// tables with the same field names as the spec, behind the functions below,
// so swapping in real Postgres + ClickHouse later means changing this file
// only — no caller changes.
//
// PRODUCTION WIRING REQUIRED: replace this module with a real Postgres
// client (workspaces/machines/api_keys) and a real ClickHouse/Timescale
// client (events), keeping the same exported function signatures.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
}

export interface Machine {
  id: string;
  workspaceId: string;
  machineId: string;
  publicKey: string;
  hostnameHash: string | null;
  firstSeen: string;
  lastSeen: string;
  mcplockVersion: string | null;
}

export interface ApiKeyRecord {
  id: string;
  workspaceId: string;
  keyId: string;
  keyHash: string;
  name: string;
  createdAt: string;
  lastUsed: string | null;
  revokedAt: string | null;
}

export interface StoredEvent {
  eventId: string;
  workspaceId: string;
  machineId: string;
  ts: string;
  type: string;
  server: string;
  tool: string;
  observedHash: string | null;
  expectedHash: string | null;
  descriptionDiff: string | null;
  clientApp: string;
  severity: string;
  ingestedAt: string;
}

export function openDb(filePath: string): Database.Database {
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS device_codes (
      device_code TEXT PRIMARY KEY,
      user_code TEXT NOT NULL UNIQUE,
      -- NULL until approved: the workspace is determined by whichever
      -- authenticated dashboard session approves the code (Part 6.2), not
      -- known at start time when the CLI is still anonymous.
      workspace_id TEXT,
      status TEXT NOT NULL, -- pending | approved | denied
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_events_workspace_ts ON events (workspace_id, ts);
  `);
  return db;
}

export function seedDevWorkspace(db: Database.Database): Workspace {
  const existing = db.prepare("SELECT * FROM workspaces LIMIT 1").get() as
    | { id: string; org_id: string; name: string; created_at: string }
    | undefined;
  if (existing) {
    return { id: existing.id, orgId: existing.org_id, name: existing.name, createdAt: existing.created_at };
  }
  const ws: Workspace = { id: randomUUID(), orgId: randomUUID(), name: "dev-workspace", createdAt: new Date().toISOString() };
  db.prepare("INSERT INTO workspaces (id, org_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    ws.id,
    ws.orgId,
    ws.name,
    ws.createdAt
  );
  return ws;
}

export function insertApiKey(db: Database.Database, rec: ApiKeyRecord): void {
  db.prepare(
    `INSERT INTO api_keys (id, workspace_id, key_id, key_hash, name, created_at, last_used, revoked_at)
     VALUES (@id, @workspaceId, @keyId, @keyHash, @name, @createdAt, @lastUsed, @revokedAt)`
  ).run(rec);
}

export function findApiKeyByKeyId(db: Database.Database, keyId: string): ApiKeyRecord | undefined {
  const row = db.prepare("SELECT * FROM api_keys WHERE key_id = ?").get(keyId) as
    | {
        id: string;
        workspace_id: string;
        key_id: string;
        key_hash: string;
        name: string;
        created_at: string;
        last_used: string | null;
        revoked_at: string | null;
      }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    keyId: row.key_id,
    keyHash: row.key_hash,
    name: row.name,
    createdAt: row.created_at,
    lastUsed: row.last_used,
    revokedAt: row.revoked_at,
  };
}

export function touchApiKeyLastUsed(db: Database.Database, keyId: string): void {
  db.prepare("UPDATE api_keys SET last_used = ? WHERE key_id = ?").run(new Date().toISOString(), keyId);
}

export function upsertMachine(db: Database.Database, m: Omit<Machine, "id" | "firstSeen" | "lastSeen"> & { firstSeen?: string }): Machine {
  const existing = db.prepare("SELECT * FROM machines WHERE machine_id = ?").get(m.machineId) as
    | { id: string; workspace_id: string; machine_id: string; public_key: string; hostname_hash: string | null; first_seen: string; last_seen: string; mcplock_version: string | null }
    | undefined;
  const now = new Date().toISOString();
  if (existing) {
    db.prepare("UPDATE machines SET public_key = ?, last_seen = ?, mcplock_version = ? WHERE machine_id = ?").run(
      m.publicKey,
      now,
      m.mcplockVersion,
      m.machineId
    );
    return { ...existing, publicKey: m.publicKey, lastSeen: now, mcplockVersion: m.mcplockVersion, id: existing.id, workspaceId: existing.workspace_id, machineId: existing.machine_id, hostnameHash: existing.hostname_hash, firstSeen: existing.first_seen };
  }
  const id = randomUUID();
  const firstSeen = m.firstSeen ?? now;
  db.prepare(
    `INSERT INTO machines (id, workspace_id, machine_id, public_key, hostname_hash, first_seen, last_seen, mcplock_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, m.workspaceId, m.machineId, m.publicKey, m.hostnameHash, firstSeen, now, m.mcplockVersion);
  return { id, workspaceId: m.workspaceId, machineId: m.machineId, publicKey: m.publicKey, hostnameHash: m.hostnameHash, firstSeen, lastSeen: now, mcplockVersion: m.mcplockVersion };
}

export function findMachine(db: Database.Database, machineId: string): Machine | undefined {
  const row = db.prepare("SELECT * FROM machines WHERE machine_id = ?").get(machineId) as
    | { id: string; workspace_id: string; machine_id: string; public_key: string; hostname_hash: string | null; first_seen: string; last_seen: string; mcplock_version: string | null }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    machineId: row.machine_id,
    publicKey: row.public_key,
    hostnameHash: row.hostname_hash,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    mcplockVersion: row.mcplock_version,
  };
}

// Idempotent: duplicate event_id (e.g. a retried batch) is silently ignored,
// not an error — the whole point of eventId-based idempotency (Part 4.2).
export function insertEventIfNew(db: Database.Database, e: StoredEvent): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO events
       (event_id, workspace_id, machine_id, ts, type, server, tool, observed_hash, expected_hash, description_diff, client_app, severity, ingested_at)
       VALUES (@eventId, @workspaceId, @machineId, @ts, @type, @server, @tool, @observedHash, @expectedHash, @descriptionDiff, @clientApp, @severity, @ingestedAt)`
    )
    .run(e);
  return result.changes > 0;
}

export function listEventsForWorkspace(db: Database.Database, workspaceId: string, limit = 100): StoredEvent[] {
  const rows = db
    .prepare("SELECT * FROM events WHERE workspace_id = ? ORDER BY ts DESC LIMIT ?")
    .all(workspaceId, limit) as Array<{
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
  return rows.map((r) => ({
    eventId: r.event_id,
    workspaceId: r.workspace_id,
    machineId: r.machine_id,
    ts: r.ts,
    type: r.type,
    server: r.server,
    tool: r.tool,
    observedHash: r.observed_hash,
    expectedHash: r.expected_hash,
    descriptionDiff: r.description_diff,
    clientApp: r.client_app,
    severity: r.severity,
    ingestedAt: r.ingested_at,
  }));
}
