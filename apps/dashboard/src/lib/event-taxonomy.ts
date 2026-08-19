// Track A ("wedge completion"): the SAME event taxonomy the CLIs use
// (packages/cli-node/src/events.ts, packages/cli-python/mcpseal/events.py)
// — same codes, same severities, same underlying decision — mirrored here
// for the dashboard. This is a THIRD independent copy of the same
// taxonomy, not a shared runtime dependency, matching this repo's
// existing precedent (cli-node and cli-python each independently mirror
// cli-core's DriftReason rather than sharing code across languages/
// runtimes — see Tasks.md 1.8). The one thing that must never drift
// between the three copies is the set of (type -> code/severity)
// mappings, since that's what "the same underlying security state is
// understandable from both terminal and browser" actually means in
// practice — not identical prose.
export interface EventDescription {
  code: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  summary: string;
  consequence: string;
  cliRemediation: string[];
}

const EVENT_TAXONOMY: Record<string, EventDescription> = {
  approved: {
    code: "TOOL_APPROVED",
    severity: "info",
    summary: "Tool definition matches the trusted baseline.",
    consequence: "Forwarded to the client normally.",
    cliRemediation: [],
  },
  blocked_denied: {
    code: "TOOL_DENIED",
    severity: "high",
    summary: "This tool's hash matches the lockfile, but it is explicitly denied.",
    consequence: "Blocked on the machine that reported this — the tool call never reached the client.",
    cliRemediation: ["mcpseal diff", "mcpseal approve <server> <tool>"],
  },
  blocked_quarantined: {
    code: "TOOL_QUARANTINED",
    severity: "high",
    summary: "This tool is quarantined pending explicit review.",
    consequence: "Blocked on the machine that reported this.",
    cliRemediation: ["mcpseal diff", "mcpseal approve <server> <tool>", "mcpseal deny <server> <tool>"],
  },
  blocked_drift: {
    code: "TOOL_CHANGED",
    severity: "critical",
    summary: "The tool's definition changed since it was approved — a rug pull.",
    consequence: "Blocked on the machine that reported this — the tool call never reached the client.",
    cliRemediation: ["mcpseal diff", "mcpseal approve <server> <tool>", "mcpseal deny <server> <tool>"],
  },
  blocked_unknown: {
    code: "TOOL_UNKNOWN",
    severity: "medium",
    summary: "This tool wasn't in the lockfile, and the policy blocks unknown tools.",
    consequence: "Blocked on the machine that reported this.",
    cliRemediation: ["mcpseal scan", "mcpseal approve <server> <tool>"],
  },
  allowed_unknown: {
    code: "TOOL_UNKNOWN_ALLOWED",
    severity: "medium",
    summary: "This tool wasn't in the lockfile, but the policy allows unknown tools through.",
    consequence: "Forwarded — consider tightening onUnknownTool if this is unexpected.",
    cliRemediation: ["mcpseal scan", "mcpseal approve <server> <tool>"],
  },
  tool_removed: {
    code: "TOOL_REMOVED",
    severity: "info",
    summary: "A previously-approved tool is no longer offered by the server.",
    consequence: "Informational only.",
    cliRemediation: ["mcpseal scan"],
  },
  blocked_error: {
    code: "INTERNAL_CHECK_ERROR",
    severity: "critical",
    summary: "An internal error occurred while checking this tool.",
    consequence: "Blocked — fail-closed: an error in the trust check is never treated as a pass.",
    cliRemediation: ["mcpseal doctor"],
  },
};

const FALLBACK: EventDescription = {
  code: "UNKNOWN_EVENT",
  severity: "medium",
  summary: "An event of an unrecognized type was recorded.",
  consequence: "See the raw event fields below.",
  cliRemediation: [],
};

export function describeEventType(type: string): EventDescription {
  return EVENT_TAXONOMY[type] ?? FALLBACK;
}
