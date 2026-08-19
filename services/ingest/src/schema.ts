// build-bible.md Part 4.1/5.1/5.2: staged production schema for the Ingest
// API's slice of the domain model. Mirrors services/ingest/src/db.ts's
// SQLite dev schema exactly (same columns/nullability/defaults). See
// services/app-api/src/schema.ts's header comment for why this is
// schema/migrations only — the runtime db.ts cutover is a separate,
// reviewed follow-up, not bundled here.
//
// Two production stores are represented here as one Postgres schema for
// now (workspaces/machines/api_keys/device_codes belong in Postgres;
// `events` belongs in ClickHouse/Timescale per Part 5.2 and will need its
// own dialect-specific schema when that swap happens — this table is
// staged in the same file as a placeholder shape, matching how db.ts
// currently treats it identically to the Postgres-backed tables).
import { pgTable, text, integer, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const machines = pgTable("machines", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  machineId: uuid("machine_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  hostnameHash: text("hostname_hash"),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
  mcplockVersion: text("mcplock_version"),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  keyId: text("key_id").notNull().unique(),
  keyHash: text("key_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastUsed: timestamp("last_used", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const deviceCodes = pgTable("device_codes", {
  deviceCode: uuid("device_code").primaryKey(),
  userCode: text("user_code").notNull().unique(),
  // NULL until approved (see db.ts's identical comment).
  workspaceId: uuid("workspace_id"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Owned by services/app-api (org creation + policy CRUD); declared here
// too, read-only from ingest's perspective — same rationale as db.ts's
// identical SQLite tables.
export const orgSigningKeys = pgTable("org_signing_keys", {
  orgId: uuid("org_id").primaryKey(),
  publicKey: text("public_key").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  version: integer("version").notNull(),
  lockfileJson: text("lockfile_json").notNull(),
  signature: text("signature"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

// Part 5.2: production home is ClickHouse/Timescale, not this Postgres
// instance — staged here only so drizzle-kit can generate a dev/local
// migration matching db.ts's current SQLite shape; a real deployment
// should replace this table with the Part 5.2 partitioned/TTL'd DDL in
// whichever of ClickHouse/Timescale gets chosen, not just apply this file
// verbatim to production Postgres.
export const events = pgTable(
  "events",
  {
    eventId: uuid("event_id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    ts: text("ts").notNull(),
    type: text("type").notNull(),
    server: text("server").notNull(),
    tool: text("tool").notNull(),
    observedHash: text("observed_hash"),
    expectedHash: text("expected_hash"),
    descriptionDiff: text("description_diff"),
    clientApp: text("client_app").notNull(),
    severity: text("severity").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
    // build-bible Part 8.3 tamper-evident audit chain — NOT NULL here
    // (unlike app-api's copy of this table, which allows NULL for rows from
    // before the column existed): every row ingest itself ever writes has
    // these populated at insert time, matching db.ts's SQLite constraint.
    prevHash: text("prev_hash").notNull(),
    chainHash: text("chain_hash").notNull(),
    batchSignature: text("batch_signature").notNull(),
  },
  (table) => [index("idx_events_workspace_ts").on(table.workspaceId, table.ts)]
);
