// build-bible.md Part 4.1/4.2/6.2: the Ingest API ("deliberately dumb and
// write-oriented... no business logic") plus the minimal device-auth /
// machine-registration surface Milestone 3 needs. Fail-closed throughout:
// any auth/signature/validation failure is a 4xx rejection, never a
// best-effort accept.
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type Database from "better-sqlite3";
import { openDb, seedDevWorkspace, findApiKeyByKeyId, touchApiKeyLastUsed, upsertMachine, findMachine, insertEventIfNew } from "./db.js";
import { parseApiKeyToken, verifySecret, verifyEd25519 } from "./crypto.js";
import { startDeviceFlow, approveDeviceCode, pollDeviceFlow } from "./device-flow.js";

const MAX_BATCH_SIZE = 500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;

const eventItemSchema = z.object({
  eventId: z.string().uuid(),
  ts: z.string(),
  type: z.string().min(1).max(64),
  server: z.string().min(1).max(256),
  tool: z.string().min(1).max(256),
  observedHash: z.string().max(128).optional(),
  expectedHash: z.string().max(128).optional(),
  descriptionDiff: z.string().max(8192).optional(),
  clientApp: z.string().max(128),
  mcplockVersion: z.string().max(32),
});

const eventsBodySchema = z.object({
  machineId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  batch: z.array(eventItemSchema).max(MAX_BATCH_SIZE),
});

const registerMachineSchema = z.object({
  workspaceId: z.string().uuid(),
  machineId: z.string().uuid(),
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/, "publicKey must be 32-byte hex"),
  mcplockVersion: z.string().max(32).optional(),
});

function severityFor(type: string): string {
  if (type === "blocked_drift" || type === "blocked_denied") return "high";
  if (type === "blocked_unknown") return "medium";
  if (type === "tool_removed") return "info";
  return "low";
}

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

export function buildApp(dbPath: string): FastifyInstance {
  const db: Database.Database = openDb(dbPath);
  const devWorkspace = seedDevWorkspace(db);
  const rateLimitBuckets = new Map<string, RateLimitBucket>();

  function checkRateLimit(key: string): boolean {
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    bucket.count++;
    return bucket.count <= RATE_LIMIT_MAX_REQUESTS;
  }

  const app = Fastify({ logger: false });

  // Capture the exact raw bytes for JSON bodies so ed25519 signatures verify
  // against precisely what was sent, not a re-serialized (and potentially
  // differently-ordered) reconstruction.
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
  // Requests without an explicit (or with a non-JSON) content-type still
  // need to reach auth/validation and get a real 401/400, not a generic 415
  // — treat any body as a JSON-parse attempt rather than rejecting on
  // content-type alone.
  app.addContentTypeParser("*", { parseAs: "string" }, jsonParser);

  async function authenticateApiKey(authHeader: string | undefined): Promise<{ workspaceId: string; keyId: string } | null> {
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length).trim();
    const parsed = parseApiKeyToken(token);
    if (!parsed) return null;
    const rec = findApiKeyByKeyId(db, parsed.keyId);
    if (!rec || rec.revokedAt) return null;
    const ok = await verifySecret(rec.keyHash, parsed.secret);
    if (!ok) return null;
    touchApiKeyLastUsed(db, parsed.keyId);
    return { workspaceId: rec.workspaceId, keyId: rec.keyId };
  }

  app.get("/healthz", async () => ({ ok: true, devWorkspaceId: devWorkspace.id }));

  // --- Device authorization flow (Part 6.2) ---
  app.post("/v1/auth/device/start", async (_req, reply) => {
    const result = startDeviceFlow(db);
    // DEV MOCK: no Dashboard exists to click "approve" yet, so this
    // auto-approves against a single hardcoded dev workspace. In
    // production the real approve call (below) supplies the approving
    // user's actual org workspace instead.
    if (process.env.MCPLOCK_DEV_AUTO_APPROVE_DEVICE === "1") {
      approveDeviceCode(db, result.userCode, devWorkspace.id);
    }
    return reply.send(result);
  });

  const pollSchema = z.object({ deviceCode: z.string().min(1) });
  app.post("/v1/auth/device/poll", async (req, reply) => {
    const parsed = pollSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });
    const result = await pollDeviceFlow(db, parsed.data.deviceCode);
    return reply.send(result);
  });

  // Production: called by an authenticated Dashboard session (Milestone 4),
  // which supplies the approving user's own org workspaceId — never a
  // client-chosen one. Not gated by session auth here since ingest has no
  // session system of its own (that's the App API's job); this endpoint
  // trusting a caller-supplied workspaceId is the explicitly-documented
  // gap until the Dashboard calls it through an authenticated proxy path.
  const approveSchema = z.object({ userCode: z.string().min(1), workspaceId: z.string().uuid() });
  app.post("/v1/auth/device/approve", async (req, reply) => {
    const parsed = approveSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request" });
    const ok = approveDeviceCode(db, parsed.data.userCode, parsed.data.workspaceId);
    if (!ok) return reply.status(404).send({ error: "unknown or expired user code" });
    return reply.send({ approved: true });
  });

  // --- Machine registration (Part 4.3) ---
  app.post("/v1/machines/register", async (req, reply) => {
    const auth = await authenticateApiKey(req.headers.authorization);
    if (!auth) return reply.status(401).send({ error: "invalid or missing API key" });

    const parsed = registerMachineSchema.safeParse((req.body as any)?.json ?? req.body);
    if (!parsed.success) return reply.status(400).send({ error: "malformed request", details: parsed.error.issues });
    if (parsed.data.workspaceId !== auth.workspaceId) {
      return reply.status(403).send({ error: "workspaceId does not match authenticated workspace" });
    }

    const machine = upsertMachine(db, {
      workspaceId: parsed.data.workspaceId,
      machineId: parsed.data.machineId,
      publicKey: parsed.data.publicKey.toLowerCase(),
      hostnameHash: null,
      mcplockVersion: parsed.data.mcplockVersion ?? null,
    });
    return reply.send({ machineId: machine.machineId, workspaceId: machine.workspaceId });
  });

  // --- Ingest (Part 4.2) ---
  app.post("/v1/events", async (req, reply) => {
    const auth = await authenticateApiKey(req.headers.authorization);
    if (!auth) return reply.status(401).send({ error: "invalid or missing API key" });

    if (!checkRateLimit(auth.keyId)) {
      return reply.status(429).send({ error: "rate limit exceeded" });
    }

    const rawBody = (req.body as any)?.raw as string | undefined;
    const jsonBody = (req.body as any)?.json ?? req.body;
    if (typeof rawBody !== "string") {
      return reply.status(400).send({ error: "malformed request body" });
    }

    const parsed = eventsBodySchema.safeParse(jsonBody);
    if (!parsed.success) {
      return reply.status(400).send({ error: "malformed request", details: parsed.error.issues });
    }
    const { machineId, workspaceId, batch } = parsed.data;

    if (workspaceId !== auth.workspaceId) {
      return reply.status(403).send({ error: "workspaceId does not match authenticated workspace" });
    }

    const machine = findMachine(db, machineId);
    if (!machine || machine.workspaceId !== workspaceId) {
      return reply.status(403).send({ error: "unknown machine for this workspace" });
    }

    const signature = req.headers["x-mcplock-signature"];
    if (typeof signature !== "string" || signature.length === 0) {
      return reply.status(401).send({ error: "missing signature" });
    }
    const verified = verifyEd25519(signature, Buffer.from(rawBody, "utf-8"), machine.publicKey);
    if (!verified) {
      // Fail closed: an unverifiable signature is rejected outright, never
      // accepted-with-a-warning (build-bible Part 9).
      return reply.status(401).send({ error: "signature verification failed" });
    }

    let accepted = 0;
    let duplicates = 0;
    const ingestedAt = new Date().toISOString();
    for (const item of batch) {
      const inserted = insertEventIfNew(db, {
        eventId: item.eventId,
        workspaceId,
        machineId,
        ts: item.ts,
        type: item.type,
        server: item.server,
        tool: item.tool,
        observedHash: item.observedHash ?? null,
        expectedHash: item.expectedHash ?? null,
        descriptionDiff: item.descriptionDiff ?? null,
        clientApp: item.clientApp,
        severity: severityFor(item.type),
        ingestedAt,
      });
      if (inserted) accepted++;
      else duplicates++;
    }

    return reply.status(202).send({ accepted, duplicates });
  });

  app.decorate("mcplockDb", db);
  app.decorate("mcplockDevWorkspace", devWorkspace);
  return app;
}
