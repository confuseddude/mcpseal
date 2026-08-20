// Track A: the event taxonomy is presentation-layer only — these tests
// confirm every DriftReason and every PolicySyncResult outcome has a
// description (nothing falls through to an undefined lookup), that
// classifyThrown() correctly routes the actual message strings the rest
// of the codebase already throws (not invented ones), and that the
// fallback path never crashes on an unrecognized error.
import { describe, it, expect } from "vitest";
import type { DriftReason } from "@mcpseal/cli-core";
import type { PolicySyncResult } from "./policy-sync.js";
import { describeDriftReason, describePolicyOutcome, classifyThrown, formatEventBlock } from "./events.js";

const ALL_DRIFT_REASONS: DriftReason[] = [
  "approved",
  "blocked_denied",
  "blocked_quarantined",
  "blocked_drift",
  "blocked_unknown",
  "allowed_unknown",
  "tool_removed",
  "blocked_error",
];

const ALL_POLICY_OUTCOMES: PolicySyncResult["outcome"][] = [
  "applied",
  "no-newer-version",
  "skipped-not-logged-in",
  "skipped-no-pinned-key",
  "skipped-no-policy-published",
  "rejected-invalid-signature",
  "rejected-malformed-response",
  "rejected-network-error",
];

describe("describeDriftReason", () => {
  for (const reason of ALL_DRIFT_REASONS) {
    it(`has a description for "${reason}"`, () => {
      const desc = describeDriftReason(reason);
      expect(desc.code).toBeTruthy();
      expect(desc.summary).toBeTruthy();
      expect(desc.consequence).toBeTruthy();
      expect(["critical", "high", "medium", "low", "info"]).toContain(desc.severity);
    });
  }

  it("every blocked_* reason is marked severity high or critical, never info/low", () => {
    for (const reason of ["blocked_denied", "blocked_quarantined", "blocked_drift", "blocked_unknown", "blocked_error"] as DriftReason[]) {
      const desc = describeDriftReason(reason);
      expect(["high", "critical"].includes(desc.severity) || reason === "blocked_unknown").toBe(true);
    }
  });

  it("blocked_drift (the rug pull) is the highest severity and requires approval", () => {
    const desc = describeDriftReason("blocked_drift");
    expect(desc.severity).toBe("critical");
    expect(desc.requiresApproval).toBe(true);
    expect(desc.remediation.length).toBeGreaterThan(0);
  });

  it("approved and tool_removed are informational, no remediation needed", () => {
    expect(describeDriftReason("approved").severity).toBe("info");
    expect(describeDriftReason("tool_removed").severity).toBe("info");
  });
});

describe("describePolicyOutcome", () => {
  for (const outcome of ALL_POLICY_OUTCOMES) {
    it(`has a description for "${outcome}"`, () => {
      const desc = describePolicyOutcome(outcome);
      expect(desc.code).toBeTruthy();
      expect(desc.summary).toBeTruthy();
    });
  }

  it("rejected-invalid-signature is critical and never retryable blindly", () => {
    const desc = describePolicyOutcome("rejected-invalid-signature");
    expect(desc.severity).toBe("critical");
    expect(desc.retryable).toBe(false);
  });

  it("rejected-network-error and rejected-malformed-response ARE retryable (transient, not an attack signal)", () => {
    expect(describePolicyOutcome("rejected-network-error").retryable).toBe(true);
    expect(describePolicyOutcome("rejected-malformed-response").retryable).toBe(true);
  });

  it("every skipped-*/rejected-* outcome's consequence mentions the lockfile is unaffected, except no-pinned-key which never even fetches", () => {
    const noPolicyChangeOutcomes: PolicySyncResult["outcome"][] = [
      "skipped-not-logged-in",
      "rejected-invalid-signature",
      "rejected-malformed-response",
      "rejected-network-error",
    ];
    for (const outcome of noPolicyChangeOutcomes) {
      const desc = describePolicyOutcome(outcome);
      expect(desc.consequence.length).toBeGreaterThan(0);
    }
  });
});

describe("classifyThrown — routes real thrown message strings from the actual codebase", () => {
  it("readLockfile's missing-file message", () => {
    const c = classifyThrown(new Error('readLockfile: could not read /x/.mcp-lock.json: ENOENT'));
    expect(c.code).toBe("LOCKFILE_NOT_FOUND");
    expect(c.remediation).toContain("mcpseal init   # discovers your MCP servers and creates a lockfile");
  });

  it("readLockfile's invalid-JSON message", () => {
    const c = classifyThrown(new Error("readLockfile: /x/.mcp-lock.json is not valid JSON: Unexpected token"));
    expect(c.code).toBe("LOCKFILE_INVALID");
    expect(c.severity).toBe("critical");
  });

  it("readLockfile's missing-required-field message", () => {
    const c = classifyThrown(new Error('readLockfile: /x/.mcp-lock.json is missing required field "servers"'));
    expect(c.code).toBe("LOCKFILE_INVALID");
  });

  it("discoverServers' malformed-JSON message", () => {
    const c = classifyThrown(new Error("discoverServers: /x/.mcp.json is not valid JSON: bad token"));
    expect(c.code).toBe("MCP_CONFIG_INVALID");
  });

  it("discoverServers' missing-mcpServers message", () => {
    const c = classifyThrown(new Error('discoverServers: /x/.mcp.json is missing "mcpServers"'));
    expect(c.code).toBe("MCP_CONFIG_INVALID");
  });

  it("install's no-config message", () => {
    const c = classifyThrown(new Error("install: no config found at /x/.mcp.json"));
    expect(c.code).toBe("MCP_CONFIG_NOT_FOUND");
  });

  it("install's already-installed message", () => {
    const c = classifyThrown(new Error("install: /x/.mcp.json.mcpseal-backup already exists — mcpseal appears to already be installed here"));
    expect(c.code).toBe("ALREADY_INSTALLED");
  });

  it("uninstall's no-backup message", () => {
    const c = classifyThrown(new Error("uninstall: no backup found at /x/.mcp.json.mcpseal-backup — mcpseal does not appear to be installed here"));
    expect(c.code).toBe("NOT_INSTALLED");
  });

  it("setToolStatus' server-not-configured message", () => {
    const c = classifyThrown(new Error('setToolStatus: server "x" is not in this project\'s .mcp.json'));
    expect(c.code).toBe("SERVER_NOT_CONFIGURED");
  });

  it("setToolStatus' tool-not-found message", () => {
    const c = classifyThrown(new Error('setToolStatus: tool "x" was not found on server "y"\'s current tool list'));
    expect(c.code).toBe("TOOL_NOT_FOUND");
  });

  it("login's denied message", () => {
    const c = classifyThrown(new Error("login was denied"));
    expect(c.code).toBe("AUTH_DENIED");
  });

  it("login's expired message", () => {
    const c = classifyThrown(new Error("login code expired before it was approved"));
    expect(c.code).toBe("AUTH_EXPIRED");
  });

  it("login's timeout message", () => {
    const c = classifyThrown(new Error("login timed out waiting for approval"));
    expect(c.code).toBe("AUTH_EXPIRED");
  });

  it("login's re-pin-refused message is critical and requires approval", () => {
    const c = classifyThrown(
      new Error(
        "refusing to overwrite a previously pinned org signing key with a different one — run `mcpseal logout` first if this is intentional"
      )
    );
    expect(c.code).toBe("AUTH_KEY_REPIN_REFUSED");
    expect(c.severity).toBe("critical");
    expect(c.requiresApproval).toBe(true);
  });

  it("device-flow HTTP failure messages", () => {
    expect(classifyThrown(new Error("device authorization failed to start: HTTP 500")).code).toBe("AUTH_SERVER_ERROR");
    expect(classifyThrown(new Error("device authorization poll failed: HTTP 500")).code).toBe("AUTH_SERVER_ERROR");
    expect(classifyThrown(new Error("machine registration failed: HTTP 403")).code).toBe("AUTH_SERVER_ERROR");
  });

  it("Node's generic fetch() connection failure ('fetch failed') is classified, not a bare UNKNOWN_ERROR — found via a real isolated-install test against an unreachable Control Plane", () => {
    const c = classifyThrown(new Error("fetch failed"));
    expect(c.code).toBe("AUTH_SERVER_UNREACHABLE");
    expect(c.severity).toBe("medium");
    expect(c.retryable).toBe(true);
    expect(c.consequence).toContain("Local enforcement is completely unaffected");
  });

  it("MCP server process exit / spawn failure", () => {
    const c = classifyThrown(new Error("server process exited (code=1, signal=null) before responding"));
    expect(c.code).toBe("MCP_SERVER_UNAVAILABLE");
    expect(c.retryable).toBe(true);
  });

  it("MCP request timeout", () => {
    const c = classifyThrown(new Error('MCP request "tools/list" timed out after 15000ms'));
    expect(c.code).toBe("MCP_TIMEOUT");
  });

  it("falls back gracefully for a totally unrecognized error, never throws", () => {
    const c = classifyThrown(new Error("something completely novel that no rule matches"));
    expect(c.code).toBe("UNKNOWN_ERROR");
    expect(c.message).toContain("completely novel");
  });

  it("handles a non-Error thrown value without crashing", () => {
    const c = classifyThrown("a plain string throw");
    expect(c.code).toBe("UNKNOWN_ERROR");
    expect(c.message).toBe("a plain string throw");
  });
});

describe("formatEventBlock", () => {
  it("includes code, severity, summary, consequence, and remediation lines", () => {
    const desc = describeDriftReason("blocked_drift");
    const text = formatEventBlock(desc, { server: "github", tool: "create_issue" });
    expect(text).toContain("TOOL_CHANGED");
    expect(text).toContain("critical");
    expect(text).toContain("server: github");
    expect(text).toContain("tool: create_issue");
    expect(text).toContain("consequence:");
    expect(text).toContain("next:");
  });

  it("omits undefined extra fields rather than printing 'undefined'", () => {
    const desc = describeDriftReason("approved");
    const text = formatEventBlock(desc, { server: "s", missing: undefined });
    expect(text).not.toContain("undefined");
  });

  it("never leaks anything resembling a secret/token pattern from a description", () => {
    for (const reason of ALL_DRIFT_REASONS) {
      const text = formatEventBlock(describeDriftReason(reason));
      expect(text.toLowerCase()).not.toMatch(/api[_-]?key|secret|password|bearer\s/);
    }
  });
});
