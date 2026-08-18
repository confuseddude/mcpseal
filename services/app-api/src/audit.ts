// build-bible.md Part 8.3: "Implement a hash chain... Combined with the
// per-event ed25519 machine signatures, you can produce an export where
// each record is independently signed and the sequence is provably
// intact... plus a verification script the auditor can run." This module
// is that verification logic — shared by the export route (so what's
// exported is provably consistent) and the standalone script in
// scripts/verify-audit.mjs (so an auditor never has to trust this
// service's own opinion of its own integrity).
import type { AuditEventRow } from "./db.js";

export interface ChainBreak {
  index: number;
  eventId: string;
  reason: "prev_hash_mismatch" | "chain_hash_mismatch";
  expected: string;
  actual: string;
}

export interface VerifyResult {
  valid: boolean;
  eventCount: number;
  breaks: ChainBreak[];
}

// Deliberately duplicated (not imported) from services/ingest/src/crypto.ts:
// an auditor's verification script must be able to recompute this from the
// exported JSON alone, with no dependency on the rest of this codebase or
// its module graph — see scripts/verify-audit.mjs, which is the sha256
// recomputation done as plainly as possible for exactly this reason.
import { createHash } from "node:crypto";

export function computeChainHash(
  prevHash: string,
  event: { eventId: string; ts: string; type: string; server: string; tool: string; observedHash: string | null; expectedHash: string | null; clientApp: string }
): string {
  const input = [prevHash, event.eventId, event.ts, event.type, event.server, event.tool, event.observedHash ?? "", event.expectedHash ?? "", event.clientApp].join("|");
  return createHash("sha256").update(input).digest("hex");
}

export function genesisHash(workspaceId: string): string {
  return createHash("sha256").update(`GENESIS:${workspaceId}`).digest("hex");
}

// Verifies a SINGLE workspace's chain (mixing workspaces would make
// "previous event" ambiguous — callers verify one workspace's export at a
// time, consistent with how the chain is built in services/ingest).
export function verifyAuditChain(workspaceId: string, events: AuditEventRow[]): VerifyResult {
  const breaks: ChainBreak[] = [];
  let expectedPrev = genesisHash(workspaceId);

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prevHash !== expectedPrev) {
      breaks.push({ index: i, eventId: e.eventId, reason: "prev_hash_mismatch", expected: expectedPrev, actual: e.prevHash });
      // Continue checking (report every break, not just the first) but
      // resync expectedPrev to what's actually there so a single break
      // doesn't cascade into a false "everything after this is also
      // broken" report.
    }
    const recomputed = computeChainHash(e.prevHash, e);
    if (recomputed !== e.chainHash) {
      breaks.push({ index: i, eventId: e.eventId, reason: "chain_hash_mismatch", expected: recomputed, actual: e.chainHash });
    }
    expectedPrev = e.chainHash;
  }

  return { valid: breaks.length === 0, eventCount: events.length, breaks };
}

export function eventsToCsv(events: AuditEventRow[]): string {
  const header = ["eventId", "workspaceId", "machineId", "ts", "type", "server", "tool", "severity", "prevHash", "chainHash", "batchSignature"];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [header.join(",")];
  for (const e of events) {
    lines.push(
      [e.eventId, e.workspaceId, e.machineId, e.ts, e.type, e.server, e.tool, e.severity, e.prevHash, e.chainHash, e.batchSignature].map(escape).join(",")
    );
  }
  return lines.join("\n");
}
