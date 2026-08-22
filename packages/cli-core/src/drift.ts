// build-bible.md Part 2.4: the drift-detection state machine.
//
// Fail-closed contract (CLAUDE.md invariant 1, docs/Tasks.md 1.6): this function
// must NEVER throw. Any internal error (malformed observed tool, missing
// server entry, etc.) is caught and converted into a `block` decision — a
// thrown exception could be caught-and-ignored by a careless caller upstream
// and silently fail open, which is the one thing this product must never do.
import type { Lockfile } from "@mcpseal/shared-types";
import { hashTool, type McpTool } from "./hash.js";

export type DriftReason =
  | "approved"
  | "blocked_denied"
  | "blocked_quarantined"
  | "blocked_drift"
  | "blocked_unknown"
  | "allowed_unknown"
  | "tool_removed"
  | "blocked_error";

export interface DriftResult {
  decision: "allow" | "block";
  reason: DriftReason;
  oldHash?: string;
  newHash?: string;
  // Populated on blocked_drift so a human can see what actually changed —
  // the hash alone isn't reversible (docs/Tasks.md 2.3 Change Log).
  oldDescription?: string;
  newDescription?: string;
  detail?: string;
}

export interface CheckDriftParams {
  // The tool definition currently observed from the live server, or
  // `undefined` if the tool that exists in the lockfile was not present in
  // the server's current tool list (Part 2.4 case 5: tool_removed).
  observedTool: McpTool | undefined;
  toolName: string;
  lockfile: Lockfile;
  serverName: string;
}

function blockError(detail: string): DriftResult {
  return { decision: "block", reason: "blocked_error", detail };
}

export function checkDrift(params: CheckDriftParams): DriftResult {
  try {
    const { observedTool, toolName, lockfile, serverName } = params;
    const server = lockfile.servers[serverName];
    const entry = server?.tools[toolName];

    // Case 5: lockfile tool absent from the server's current tool list.
    if (observedTool === undefined) {
      if (entry === undefined) {
        // Nothing in the lockfile to have been removed — not a valid call
        // for this branch. Fail closed rather than silently no-op.
        return blockError(
          `checkDrift: no observed tool and no lockfile entry for "${toolName}" on server "${serverName}"`
        );
      }
      return { decision: "allow", reason: "tool_removed", oldHash: entry.hash };
    }

    const newHash = hashTool(observedTool);

    // Case 4: tool name not in lockfile — apply onUnknownTool policy.
    if (entry === undefined) {
      const block = lockfile.policy.onUnknownTool === "block";
      return {
        decision: block ? "block" : "allow",
        reason: block ? "blocked_unknown" : "allowed_unknown",
        newHash,
      };
    }

    // Case 3: hash differs from the pinned lockfile hash — the rug pull.
    if (newHash !== entry.hash) {
      return {
        decision: "block",
        reason: "blocked_drift",
        oldHash: entry.hash,
        newHash,
        oldDescription: entry.description,
        newDescription: observedTool.description,
      };
    }

    // Hash matches — decision now depends on the pinned status.
    if (entry.status === "denied") {
      return { decision: "block", reason: "blocked_denied", oldHash: entry.hash, newHash };
    }
    if (entry.status === "quarantined") {
      return { decision: "block", reason: "blocked_quarantined", oldHash: entry.hash, newHash };
    }

    // Case 1: hash matches an approved entry — forward normally.
    return { decision: "allow", reason: "approved", oldHash: entry.hash, newHash };
  } catch (err) {
    return blockError(`checkDrift: internal error: ${(err as Error).message}`);
  }
}
