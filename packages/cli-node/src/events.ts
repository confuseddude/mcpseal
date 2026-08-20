// Track A ("wedge completion"): a single, coherent event taxonomy for
// everything mcpseal can report to a developer, so the CLI never surfaces
// a raw, unexplained error when it can instead give a diagnosis +
// consequence + remediation.
//
// Deliberately NOT a rewrite of any existing security logic:
// - `DriftReason` (cli-core's drift.ts) stays exactly as-is — those values
//   are already the de-facto event taxonomy for block/allow decisions,
//   already flow through the event log, the ingest API, the audit hash
//   chain, and existing tests. This module only adds an EXPLANATION layer
//   on top of the existing reason strings, it never changes them.
// - `PolicySyncResult`'s `outcome` union (policy-sync.ts) stays as-is for
//   the same reason — this module maps each outcome to a description, it
//   doesn't touch pull_and_apply_policy's return shape (several tests
//   assert on it with exact `toEqual`).
// - Every existing `throw new Error(...)` site keeps its exact message
//   text (existing tests assert on message substrings via `.toThrow(/…/)`).
//   `classifyThrown()` below pattern-matches on those SAME strings to
//   attach a code/remediation without touching the throw sites themselves.
import type { DriftReason } from "@mcpseal/cli-core";
import type { PolicySyncResult } from "./policy-sync.js";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface EventDescription {
  code: string;
  severity: Severity;
  summary: string;
  consequence: string;
  remediation: string[];
  retryable: boolean;
  requiresNetwork: boolean;
  requiresApproval: boolean;
}

function d(partial: EventDescription): EventDescription {
  return partial;
}

// --- Drift/trust decisions (cli-core's DriftReason) ---
const DRIFT_EVENTS: Record<DriftReason, EventDescription> = {
  approved: d({
    code: "TOOL_APPROVED",
    severity: "info",
    summary: "Tool definition matches the trusted baseline.",
    consequence: "Forwarded to the client normally.",
    remediation: [],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: false,
  }),
  blocked_denied: d({
    code: "TOOL_DENIED",
    severity: "high",
    summary: "This tool's hash matches the lockfile, but it is explicitly denied.",
    consequence: "Blocked — the tool call never reaches the client.",
    remediation: ["mcpseal diff", "mcpseal approve <server> <tool>   # only if you intend to trust it now"],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: true,
  }),
  blocked_quarantined: d({
    code: "TOOL_QUARANTINED",
    severity: "high",
    summary: "This tool is quarantined pending explicit review.",
    consequence: "Blocked — the tool call never reaches the client.",
    remediation: ["mcpseal diff", "mcpseal approve <server> <tool>   # after you've reviewed it", "mcpseal deny <server> <tool>"],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: true,
  }),
  blocked_drift: d({
    code: "TOOL_CHANGED",
    severity: "critical",
    summary: "The tool's definition (description and/or input schema) differs from the trusted baseline — a rug pull.",
    consequence: "Blocked — the tool call never reaches the client.",
    remediation: ["mcpseal diff", "mcpseal approve <server> <tool>   # only after reviewing the change", "mcpseal deny <server> <tool>"],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: true,
  }),
  blocked_unknown: d({
    code: "TOOL_UNKNOWN",
    severity: "medium",
    summary: "This tool isn't in the lockfile at all, and the policy blocks unknown tools.",
    consequence: "Blocked — the tool call never reaches the client.",
    remediation: ["mcpseal scan", "mcpseal approve <server> <tool>   # to trust it going forward"],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: true,
  }),
  allowed_unknown: d({
    code: "TOOL_UNKNOWN_ALLOWED",
    severity: "medium",
    summary: "This tool isn't in the lockfile, but the policy allows unknown tools through.",
    consequence: "Forwarded to the client — consider tightening onUnknownTool if this is unexpected.",
    remediation: ["mcpseal scan", "mcpseal approve <server> <tool>   # to pin it explicitly"],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: false,
  }),
  tool_removed: d({
    code: "TOOL_REMOVED",
    severity: "info",
    summary: "A tool that was previously in the lockfile is no longer offered by the server.",
    consequence: "Informational only — nothing to block, there's no live call to intercept.",
    remediation: ["mcpseal scan   # confirms the current live tool set"],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: false,
  }),
  blocked_error: d({
    code: "INTERNAL_CHECK_ERROR",
    severity: "critical",
    summary: "An internal error occurred while checking this tool against the lockfile.",
    consequence: "Blocked — fail-closed: an error in the trust check is never treated as a pass.",
    remediation: ["mcpseal doctor", "mcpseal scan   # re-run to see if this reproduces"],
    retryable: true,
    requiresNetwork: false,
    requiresApproval: false,
  }),
};

export function describeDriftReason(reason: DriftReason): EventDescription {
  return DRIFT_EVENTS[reason];
}

// --- Signed policy pull (policy-sync.ts's PolicySyncResult.outcome) ---
const POLICY_EVENTS: Record<PolicySyncResult["outcome"], EventDescription> = {
  applied: d({
    code: "POLICY_APPLIED",
    severity: "info",
    summary: "A newer, correctly-signed policy was verified and applied.",
    consequence: ".mcp-lock.json was atomically replaced.",
    remediation: [],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: false,
  }),
  "no-newer-version": d({
    code: "POLICY_UP_TO_DATE",
    severity: "info",
    summary: "The published policy version is not newer than what's already applied.",
    consequence: "No change — this is a no-op, not an error.",
    remediation: [],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: false,
  }),
  "skipped-not-logged-in": d({
    code: "POLICY_SKIPPED_NOT_LOGGED_IN",
    severity: "info",
    summary: "No workspace connection is configured.",
    consequence: "Local enforcement continues unaffected — this only concerns organization-pushed policy.",
    remediation: ["mcpseal login"],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: false,
  }),
  "skipped-no-pinned-key": d({
    code: "POLICY_NO_PINNED_KEY",
    severity: "high",
    summary: "No org signing key is pinned for this workspace.",
    consequence: "Fail-closed: no policy can be trusted without a pinned key to verify it against, so none was even requested.",
    remediation: ["mcpseal login   # re-pins the org's signing key"],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: false,
  }),
  "skipped-no-policy-published": d({
    code: "POLICY_NONE_PUBLISHED",
    severity: "info",
    summary: "The organization has not published a policy for this workspace yet.",
    consequence: "No change to the local lockfile.",
    remediation: [],
    retryable: true,
    requiresNetwork: true,
    requiresApproval: false,
  }),
  "rejected-invalid-signature": d({
    code: "POLICY_INVALID_SIGNATURE",
    severity: "critical",
    summary: "The policy's signature does not verify against the pinned org public key.",
    consequence: "REJECTED — fail-closed. The last-known-good local lockfile remains active, byte-for-byte untouched.",
    remediation: [
      "Do not retry blindly — this can mean the update was tampered with in transit, or the org's signing key was rotated unexpectedly.",
      "Verify out-of-band with your organization admin, then `mcpseal login` again if a re-pin is genuinely expected.",
    ],
    retryable: false,
    requiresNetwork: false,
    requiresApproval: true,
  }),
  "rejected-malformed-response": d({
    code: "POLICY_MALFORMED_RESPONSE",
    severity: "high",
    summary: "The server's response was missing required fields or otherwise malformed.",
    consequence: "REJECTED — the existing local lockfile remains active, untouched.",
    remediation: ["mcpseal doctor", "mcpseal policy-pull   # retry — this can be a transient server-side issue"],
    retryable: true,
    requiresNetwork: true,
    requiresApproval: false,
  }),
  "rejected-network-error": d({
    code: "POLICY_NETWORK_ERROR",
    severity: "medium",
    summary: "Could not reach the Control Plane to check for a policy update.",
    consequence: "The existing local lockfile remains active — local enforcement is unaffected by Control Plane availability.",
    remediation: ["mcpseal doctor", "mcpseal policy-pull   # retry once connectivity is restored"],
    retryable: true,
    requiresNetwork: true,
    requiresApproval: false,
  }),
};

export function describePolicyOutcome(outcome: PolicySyncResult["outcome"]): EventDescription {
  return POLICY_EVENTS[outcome];
}

// --- Generic error classification for existing `throw new Error(...)`
// sites across config-discovery.ts, install.ts, manage.ts, login.ts, and
// cli-core's lockfile.ts. Matches on the SAME message prefixes those
// files already throw (unchanged) — this is presentation-layer pattern
// matching, not a change to what gets thrown or its text.
export interface ClassifiedError extends EventDescription {
  message: string;
}

interface ClassifierRule {
  test: (message: string) => boolean;
  describe: EventDescription;
}

const RULES: ClassifierRule[] = [
  {
    test: (m) => m.includes("readLockfile:") && m.includes("could not read"),
    describe: d({
      code: "LOCKFILE_NOT_FOUND",
      severity: "high",
      summary: "No .mcp-lock.json found in this project.",
      consequence: "Fail-closed: the proxy refuses to start without a lockfile to check tools against.",
      remediation: ["mcpseal init   # discovers your MCP servers and creates a lockfile"],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.includes("readLockfile:") && (m.includes("not valid JSON") || m.includes("missing required field") || m.includes("does not contain a JSON object")),
    describe: d({
      code: "LOCKFILE_INVALID",
      severity: "critical",
      summary: "The lockfile exists but is malformed or corrupted.",
      consequence: "Fail-closed: an unparseable lockfile is treated as untrusted, not as \"nothing to check.\"",
      remediation: [
        "Inspect .mcp-lock.json for corruption (bad merge, manual edit, truncated write).",
        "Restore from git history if available, or re-run `mcpseal init` to regenerate it (this resets all approvals).",
      ],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.startsWith("discoverServers:") && m.includes("is not valid JSON"),
    describe: d({
      code: "MCP_CONFIG_INVALID",
      severity: "high",
      summary: ".mcp.json exists but is not valid JSON.",
      consequence: "mcpseal cannot discover which MCP servers to protect.",
      remediation: ["Fix the JSON syntax error in .mcp.json (check for trailing commas, unmatched braces)."],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.startsWith("discoverServers:"),
    describe: d({
      code: "MCP_CONFIG_INVALID",
      severity: "high",
      summary: ".mcp.json is missing a required field or has the wrong shape.",
      consequence: "mcpseal cannot discover which MCP servers to protect.",
      remediation: ["Check .mcp.json against Claude Code's mcpServers schema (each server needs at least a \"command\")."],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.startsWith("install:") && m.includes("no config found"),
    describe: d({
      code: "MCP_CONFIG_NOT_FOUND",
      severity: "high",
      summary: "No .mcp.json found in this project.",
      consequence: "There's nothing for `mcpseal install` to rewrite.",
      remediation: ["mcpseal init   # creates the lockfile from your existing MCP config first"],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.startsWith("install:") && m.includes("already exists"),
    describe: d({
      code: "ALREADY_INSTALLED",
      severity: "info",
      summary: "mcpseal already appears to be installed in this project (a backup config already exists).",
      consequence: "No change made — install is refusing to overwrite an existing backup.",
      remediation: ["mcpseal uninstall   # if you want to reset and reinstall"],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.startsWith("uninstall:") && m.includes("no backup found"),
    describe: d({
      code: "NOT_INSTALLED",
      severity: "info",
      summary: "mcpseal does not appear to be installed in this project (no backup config found).",
      consequence: "No change made.",
      remediation: ["mcpseal install   # if you intended to install first"],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.startsWith("setToolStatus:") && m.includes("is not in this project"),
    describe: d({
      code: "SERVER_NOT_CONFIGURED",
      severity: "medium",
      summary: "That server name isn't in this project's .mcp.json.",
      consequence: "Nothing to approve/deny.",
      remediation: ["mcpseal scan   # lists the currently-configured server names"],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.startsWith("setToolStatus:") && m.includes("was not found on server"),
    describe: d({
      code: "TOOL_NOT_FOUND",
      severity: "medium",
      summary: "That tool name isn't in the server's current live tool list.",
      consequence: "Nothing to approve/deny — approve/deny always re-fetch the live definition, they never trust a stale name.",
      remediation: ["mcpseal scan   # lists the currently-live tool names for this server"],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    // Real gap found via an actual isolated-install test of the published
    // package (not caught by any unit test, since those inject fetchImpl
    // and never hit a real DNS/connection failure): Node's fetch() throws
    // exactly the string "fetch failed" for ANY connection-level failure
    // (refused, DNS, TLS) — none of the existing login.ts throw sites'
    // messages ("device authorization failed to start: HTTP...") ever run,
    // because those only fire once fetch() has already resolved to a
    // Response. Without this rule, a brand new user's very first
    // `mcpseal login` attempt against an unreachable/not-yet-deployed
    // Control Plane showed a bare "[UNKNOWN_ERROR] An unexpected error
    // occurred" with zero context — exactly the "unexplained ERROR" this
    // whole taxonomy exists to prevent.
    test: (m) => m === "fetch failed",
    describe: d({
      code: "AUTH_SERVER_UNREACHABLE",
      severity: "medium",
      summary: "Could not reach the Control Plane server at all (connection failed).",
      consequence: "Login did not complete. Local enforcement is completely unaffected — everything except login/policy-pull/event-shipping works exactly the same without it.",
      remediation: [
        "This is expected if your organization hasn't set up a workspace yet.",
        "mcpseal doctor",
        "mcpseal login   # retry once the server is reachable",
      ],
      retryable: true,
      requiresNetwork: true,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.includes("device authorization failed to start") || m.includes("device authorization poll failed") || m.includes("machine registration failed"),
    describe: d({
      code: "AUTH_SERVER_ERROR",
      severity: "medium",
      summary: "The Control Plane rejected or failed to handle a login request.",
      consequence: "Login did not complete. Local enforcement is completely unaffected.",
      remediation: ["mcpseal doctor", "mcpseal login   # retry"],
      retryable: true,
      requiresNetwork: true,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m === "login was denied",
    describe: d({
      code: "AUTH_DENIED",
      severity: "info",
      summary: "The device login request was denied.",
      consequence: "No workspace connection was made. Local enforcement is unaffected.",
      remediation: ["mcpseal login   # try again if this was unintentional"],
      retryable: true,
      requiresNetwork: true,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.includes("login code expired") || m === "login timed out waiting for approval",
    describe: d({
      code: "AUTH_EXPIRED",
      severity: "info",
      summary: "The device login code expired before it was approved.",
      consequence: "No workspace connection was made. Local enforcement is unaffected.",
      remediation: ["mcpseal login   # generates a fresh code"],
      retryable: true,
      requiresNetwork: true,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.includes("refusing to overwrite a previously pinned org signing key"),
    describe: d({
      code: "AUTH_KEY_REPIN_REFUSED",
      severity: "critical",
      summary: "This login would pin a DIFFERENT org signing key than the one already trusted on this machine.",
      consequence: "Fail-closed: refused. Nothing was changed — the previously pinned key and existing credentials remain in place.",
      remediation: [
        "This is either a compromised org, or you're intentionally switching workspaces.",
        "If intentional: `mcpseal logout` first, then `mcpseal login` again.",
        "If not expected: do not proceed — investigate with your organization admin.",
      ],
      retryable: false,
      requiresNetwork: false,
      requiresApproval: true,
    }),
  },
  {
    test: (m) => m.includes("server process exited") || m.includes("spawn"),
    describe: d({
      code: "MCP_SERVER_UNAVAILABLE",
      severity: "high",
      summary: "The MCP server process could not be started or exited unexpectedly.",
      consequence: "No tool list could be verified for this server.",
      remediation: [
        "Confirm the server's command/args in .mcp.json are correct and runnable on their own.",
        "mcpseal doctor",
      ],
      retryable: true,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
  {
    test: (m) => m.includes("timed out after"),
    describe: d({
      code: "MCP_TIMEOUT",
      severity: "medium",
      summary: "The MCP server did not respond in time.",
      consequence: "No tool list could be verified for this server within the timeout.",
      remediation: ["Retry — a slow server start (e.g. npx cold cache) can cause a one-off timeout.", "mcpseal doctor"],
      retryable: true,
      requiresNetwork: false,
      requiresApproval: false,
    }),
  },
];

const FALLBACK = d({
  code: "UNKNOWN_ERROR",
  severity: "high",
  summary: "An unexpected error occurred.",
  consequence: "The operation did not complete.",
  remediation: ["mcpseal doctor", "Re-run with --json for a machine-readable error if filing an issue."],
  retryable: true,
  requiresNetwork: false,
  requiresApproval: false,
});

export function classifyThrown(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  const rule = RULES.find((r) => r.test(message));
  return { ...(rule?.describe ?? FALLBACK), message };
}

// --- Rendering helpers (terminal output) ---
export function formatEventBlock(desc: EventDescription, extra?: Record<string, string | undefined>): string {
  const lines: string[] = [];
  lines.push(`[${desc.code}] (${desc.severity})`);
  lines.push(desc.summary);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push(`  consequence: ${desc.consequence}`);
  if (desc.remediation.length > 0) {
    lines.push("  next:");
    for (const cmd of desc.remediation) lines.push(`    ${cmd}`);
  }
  return lines.join("\n");
}
