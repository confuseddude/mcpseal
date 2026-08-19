import { describe, expect, it } from "vitest";
import type { Lockfile } from "@mcpseal/shared-types";
import { hashTool, type McpTool } from "./hash.js";
import { checkDrift } from "./drift.js";

const tool: McpTool = {
  name: "create_issue",
  description: "Create a new GitHub issue in a repository",
  inputSchema: { type: "object", properties: { title: { type: "string" } } },
};

function baseLockfile(overrides?: Partial<Lockfile["servers"][string]["tools"][string]>): Lockfile {
  return {
    version: 1,
    generatedAt: "2026-08-17T00:00:00Z",
    generatedBy: "mcpseal@test",
    servers: {
      github: {
        transport: "stdio",
        command: "npx",
        args: [],
        commandHash: "sha256:cmd",
        tools: {
          create_issue: {
            hash: hashTool(tool),
            description: tool.description,
            approvedAt: "2026-08-17T00:00:00Z",
            approvedBy: "local",
            status: "approved",
            ...overrides,
          },
        },
      },
    },
    policy: { onDrift: "block", onUnknownTool: "block", allowNewToolsFromApprovedServer: false },
    signature: null,
  };
}

describe("checkDrift — Part 2.4 five cases", () => {
  it("case 1: hash matches an approved entry -> forward (allow)", () => {
    const result = checkDrift({
      observedTool: tool,
      toolName: "create_issue",
      lockfile: baseLockfile(),
      serverName: "github",
    });
    expect(result).toMatchObject({ decision: "allow", reason: "approved" });
  });

  it("case 2: hash matches a denied entry -> block, blocked_denied", () => {
    const result = checkDrift({
      observedTool: tool,
      toolName: "create_issue",
      lockfile: baseLockfile({ status: "denied" }),
      serverName: "github",
    });
    expect(result).toMatchObject({ decision: "block", reason: "blocked_denied" });
  });

  it("case 3: tool name exists but hash differs -> block, blocked_drift, surfaces old vs new hash", () => {
    const mutated: McpTool = { ...tool, description: tool.description + " — now steals ~/.ssh" };
    const result = checkDrift({
      observedTool: mutated,
      toolName: "create_issue",
      lockfile: baseLockfile(),
      serverName: "github",
    });
    expect(result.decision).toBe("block");
    expect(result.reason).toBe("blocked_drift");
    expect(result.oldHash).toBe(hashTool(tool));
    expect(result.newHash).toBe(hashTool(mutated));
    expect(result.oldHash).not.toBe(result.newHash);
    expect(result.oldDescription).toBe(tool.description);
    expect(result.newDescription).toBe(mutated.description);
    expect(result.oldDescription).not.toBe(result.newDescription);
  });

  it("case 4: tool name not in lockfile -> apply onUnknownTool (default block), blocked_unknown", () => {
    const lockfile = baseLockfile();
    const result = checkDrift({
      observedTool: { ...tool, name: "delete_repo" },
      toolName: "delete_repo",
      lockfile,
      serverName: "github",
    });
    expect(result).toMatchObject({ decision: "block", reason: "blocked_unknown" });
  });

  it("case 4b: unknown tool is allowed when onUnknownTool policy is not 'block'", () => {
    const lockfile = baseLockfile();
    lockfile.policy.onUnknownTool = "allow";
    const result = checkDrift({
      observedTool: { ...tool, name: "delete_repo" },
      toolName: "delete_repo",
      lockfile,
      serverName: "github",
    });
    expect(result).toMatchObject({ decision: "allow", reason: "allowed_unknown" });
  });

  it("case 5: lockfile tool absent from server -> tool_removed, informational, not blocked", () => {
    const result = checkDrift({
      observedTool: undefined,
      toolName: "create_issue",
      lockfile: baseLockfile(),
      serverName: "github",
    });
    expect(result).toMatchObject({ decision: "allow", reason: "tool_removed" });
  });

  it("extra: hash matches a quarantined entry -> block, blocked_quarantined", () => {
    const result = checkDrift({
      observedTool: tool,
      toolName: "create_issue",
      lockfile: baseLockfile({ status: "quarantined" }),
      serverName: "github",
    });
    expect(result).toMatchObject({ decision: "block", reason: "blocked_quarantined" });
  });
});

describe("checkDrift — fail-closed on internal error (never throws)", () => {
  it("returns a block decision instead of throwing when the observed tool is malformed", () => {
    const malformed = { name: 42, description: "x", inputSchema: {} } as unknown as McpTool;
    let result;
    expect(() => {
      result = checkDrift({
        observedTool: malformed,
        toolName: "create_issue",
        lockfile: baseLockfile(),
        serverName: "github",
      });
    }).not.toThrow();
    expect(result).toMatchObject({ decision: "block", reason: "blocked_error" });
  });

  it("returns a block decision when called with no observed tool and no matching lockfile entry", () => {
    const result = checkDrift({
      observedTool: undefined,
      toolName: "nonexistent_tool",
      lockfile: baseLockfile(),
      serverName: "github",
    });
    expect(result).toMatchObject({ decision: "block", reason: "blocked_error" });
  });

  it("returns a block decision when the server itself is not in the lockfile", () => {
    const result = checkDrift({
      observedTool: tool,
      toolName: "create_issue",
      lockfile: baseLockfile(),
      serverName: "nonexistent_server",
    });
    expect(result).toMatchObject({ decision: "block", reason: "blocked_unknown" });
  });
});
