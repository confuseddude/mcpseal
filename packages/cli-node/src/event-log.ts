// build-bible.md Part 3.4 / 4.2, Tasks.md 2.5: local append-only event log
// at ~/.mcpseal/events.jsonl. Purely local, no account required — the same
// record shape gets shipped to the Control Plane later (Milestone 3) if the
// user opts into a workspace, only the destination changes.
//
// Per-event shape matches Part 4.2's batch items minus the envelope fields
// that don't exist on the free tier yet (machineId, workspaceId, signature
// live at the batch/transport level, not per event).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DriftReason } from "@mcpseal/cli-core";
import { VERSION } from "./version.js";

export interface McpsealEvent {
  eventId: string;
  ts: string;
  type: DriftReason;
  server: string;
  tool: string;
  observedHash?: string;
  expectedHash?: string;
  descriptionDiff?: string;
  clientApp: string;
  mcpsealVersion: string;
}

export function eventsLogPath(): string {
  return path.join(homedir(), ".mcpseal", "events.jsonl");
}

export interface AppendEventInput {
  type: DriftReason;
  server: string;
  tool: string;
  observedHash?: string;
  expectedHash?: string;
  oldDescription?: string;
  newDescription?: string;
  clientApp?: string;
}

// Best-effort: a logging failure (e.g. unwritable home directory) must never
// break the proxy's actual block decision, which has already happened by
// the time this is called. Callers should not treat this as fail-closed.
export function appendEvent(input: AppendEventInput, logPath: string = eventsLogPath()): void {
  try {
    const event: McpsealEvent = {
      eventId: randomUUID(),
      ts: new Date().toISOString(),
      type: input.type,
      server: input.server,
      tool: input.tool,
      observedHash: input.observedHash,
      expectedHash: input.expectedHash,
      descriptionDiff:
        input.oldDescription !== undefined && input.newDescription !== undefined
          ? `- ${input.oldDescription}\n+ ${input.newDescription}`
          : undefined,
      clientApp: input.clientApp ?? "unknown",
      mcpsealVersion: VERSION,
    };
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(event) + "\n", "utf-8");
  } catch (err) {
    console.error(`mcpseal: warning: could not write to local event log: ${(err as Error).message}`);
  }
}

export function readEvents(logPath: string = eventsLogPath()): McpsealEvent[] {
  if (!existsSync(logPath)) return [];
  const raw = readFileSync(logPath, "utf-8");
  const events: McpsealEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip a corrupted line rather than fail the whole read
    }
  }
  return events;
}

export function recentBlocks(events: McpsealEvent[], limit = 10): McpsealEvent[] {
  // Timestamp ties are common, not theoretical: `toISOString()` is only
  // millisecond-precision, and the system clock's granularity (coarse on
  // Windows in particular) routinely stamps two events written
  // back-to-back with the SAME `ts`. Array.prototype.sort is stable, so
  // comparing `ts` alone would preserve append order within a tied group
  // and hand back the OLDEST event as "most recent" -- silently
  // misreporting which tool was blocked last.
  //
  // The log is append-ordered, so position is the correct tiebreaker:
  // later in the file means later in time. Mirrors recent_blocks() in
  // packages/cli-python/mcpseal/event_log.py.
  return events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.type.startsWith("blocked"))
    .sort((a, b) => b.e.ts.localeCompare(a.e.ts) || b.i - a.i)
    .slice(0, limit)
    .map(({ e }) => e);
}
