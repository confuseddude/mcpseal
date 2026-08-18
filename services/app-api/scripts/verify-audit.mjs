#!/usr/bin/env node
// build-bible.md Part 8.3: "a verification script the auditor can run."
//
// Deliberately dependency-free (only node:crypto and node:fs) and
// self-contained: an auditor should be able to read this file top to
// bottom and trust it without trusting the rest of the codebase, then
// point it at a JSON export downloaded from GET /v1/audit/export.
//
// Usage: node verify-audit.mjs <export.json>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function genesisHash(workspaceId) {
  return createHash("sha256").update(`GENESIS:${workspaceId}`).digest("hex");
}

function computeChainHash(prevHash, event) {
  const input = [
    prevHash,
    event.eventId,
    event.ts,
    event.type,
    event.server,
    event.tool,
    event.observedHash ?? "",
    event.expectedHash ?? "",
    event.clientApp,
  ].join("|");
  return createHash("sha256").update(input).digest("hex");
}

function verifyWorkspace(workspaceId, events) {
  const breaks = [];
  let expectedPrev = genesisHash(workspaceId);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prevHash !== expectedPrev) {
      breaks.push({ index: i, eventId: e.eventId, reason: "prev_hash_mismatch — chain has a gap (deletion, reorder, or injection)" });
    }
    const recomputed = computeChainHash(e.prevHash, e);
    if (recomputed !== e.chainHash) {
      breaks.push({ index: i, eventId: e.eventId, reason: "chain_hash_mismatch — this event's own fields were modified after ingest" });
    }
    expectedPrev = e.chainHash;
  }
  return breaks;
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node verify-audit.mjs <export.json>");
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  const events = data.events ?? data; // accept either the full export or a bare event array

  const byWorkspace = new Map();
  for (const e of events) {
    const list = byWorkspace.get(e.workspaceId) ?? [];
    list.push(e);
    byWorkspace.set(e.workspaceId, list);
  }

  let anyBroken = false;
  for (const [workspaceId, workspaceEvents] of byWorkspace) {
    const breaks = verifyWorkspace(workspaceId, workspaceEvents);
    if (breaks.length === 0) {
      console.log(`workspace ${workspaceId}: OK (${workspaceEvents.length} events, chain intact)`);
    } else {
      anyBroken = true;
      console.log(`workspace ${workspaceId}: BROKEN (${breaks.length} problem(s) found)`);
      for (const b of breaks) {
        console.log(`  - event ${b.eventId} (index ${b.index}): ${b.reason}`);
      }
    }
  }

  process.exit(anyBroken ? 1 : 0);
}

main();
