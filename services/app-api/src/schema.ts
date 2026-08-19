// build-bible.md Part 5.1: the Postgres domain model. This is the real
// production schema — declarative source of truth for `drizzle-kit
// generate`'s migrations. Table shapes mirror services/app-api/src/db.ts's
// SQLite dev schema exactly (same columns, same nullability, same
// defaults), since that file's own comment already promises "PRODUCTION
// WIRING REQUIRED: replace with a real Postgres client, keeping these
// function signatures" — this is that schema, staged ahead of the
// runtime-adapter cutover (see NIGHT_SHIFT_LOG.md for why the cutover
// itself — swapping db.ts's SQLite calls for these tables — is left as a
// separate, reviewed change rather than bundled in here: it touches every
// query in the org/user/session/RBAC path, the single most
// security-sensitive read/write surface in the App API per CLAUDE.md's
// "extra scrutiny" rule, and deserves its own checkpoint rather than
// riding along with schema/migration scaffolding).
import { pgTable, text, integer, boolean, timestamp, uuid } from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(true),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  orgId: uuid("org_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
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

export const orgSigningKeys = pgTable("org_signing_keys", {
  orgId: uuid("org_id").primaryKey(),
  publicKey: text("public_key").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const ssoConfigs = pgTable("sso_configs", {
  orgId: uuid("org_id").primaryKey(),
  provider: text("provider").notNull(),
  domain: text("domain").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  scimTokenHash: text("scim_token_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().unique(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubId: text("stripe_sub_id"),
  plan: text("plan").notNull().default("free"),
  seats: integer("seats").notNull().default(1),
  status: text("status").notNull().default("active"),
});

// Owned by services/ingest in normal operation; declared here too so
// app-api can read/join them regardless of which service migrates first
// against the shared Postgres instance — same rationale as the SQLite dev
// schema's identical comment.
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
  mcpsealVersion: text("mcpseal_version"),
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

export const events = pgTable("events", {
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
  // build-bible Part 8.3 tamper-evident audit chain (see db.ts's identical
  // comment on the SQLite version of this table).
  prevHash: text("prev_hash"),
  chainHash: text("chain_hash"),
  batchSignature: text("batch_signature"),
});

// Owned by services/ingest (device-code lifecycle); declared here too so
// app-api's /v1/machines/connect can approve a code directly against the
// shared Postgres instance, same pattern as the SQLite dev schema.
export const deviceCodes = pgTable("device_codes", {
  deviceCode: uuid("device_code").primaryKey(),
  userCode: text("user_code").notNull().unique(),
  workspaceId: uuid("workspace_id"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
